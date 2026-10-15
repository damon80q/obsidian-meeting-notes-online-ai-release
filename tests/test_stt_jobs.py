"""실제 하위 프로세스로 취소·중복·재시작을 검증합니다. 모델/사용자 원음은 사용하지 않습니다."""
import http.client
import io
from unittest.mock import patch
from types import SimpleNamespace
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from stt_jobs import TranscriptionJobs, JobError, atomic_json
from transcribe import create_server, settings_from_env


class JobsTests(unittest.TestCase):
    def make_jobs(self, seconds=60):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.processes = []
        def factory(audio, result):
            script = 'import time,json,sys;time.sleep(float(sys.argv[1]));open(sys.argv[2],"w").write(json.dumps({"text":"원문 그대로"}))'
            process = subprocess.Popen([sys.executable, '-c', script, str(seconds), str(result)], start_new_session=True)
            self.processes.append(process)
            return process
        jobs = TranscriptionJobs(settings_from_env({}), temporary.name, factory)
        self.addCleanup(jobs.close)
        return jobs

    def wait_finished(self, jobs, identifier):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = jobs.get(identifier)
            if result['state'] not in ('running', 'cancelling'):
                return result
            time.sleep(0.01)
        self.fail('job did not finish')

    def test_actual_cancel_stops_process_releases_slot_and_keeps_source(self):
        jobs = self.make_jobs()
        source = Path(jobs.directory) / 'user-source.webm'
        source.write_bytes(b'synthetic source')
        result = jobs.submit(source.read_bytes())
        process = self.processes[-1]
        self.assertTrue(jobs.busy())
        self.assertEqual(jobs.cancel(result['id'])['state'], 'cancelled')
        self.assertIsNotNone(process.poll())
        with self.assertRaises(ProcessLookupError):
            os.kill(process.pid, 0)
        self.assertFalse(jobs.busy())
        self.assertEqual(source.read_bytes(), b'synthetic source')
        self.assertFalse((jobs.directory / (result['id'] + '.audio')).exists())
        second = jobs.submit(b'another synthetic audio')
        self.assertNotEqual(second['id'], result['id'])
        self.assertEqual(jobs.cancel(result['id'])['state'], 'cancelled')
        self.assertTrue(jobs.busy())  # 以前 작업 취소 재호출이 새 작업을 멈추면 안 됩니다.

    def test_duplicate_running_and_completed_reuse_one_inference(self):
        jobs = self.make_jobs(0.1)
        first = jobs.submit(b'same synthetic audio')
        self.assertEqual(jobs.submit(b'same synthetic audio')['id'], first['id'])
        with self.assertRaises(JobError) as caught:
            jobs.submit(b'different synthetic audio')
        self.assertEqual(caught.exception.status, 429)
        result = self.wait_finished(jobs, first['id'])
        self.assertEqual(result['state'], 'completed')
        self.assertEqual(result['text'], '원문 그대로')
        self.assertEqual(jobs.submit(b'same synthetic audio')['id'], first['id'])
        self.assertEqual(len(self.processes), 1)
        self.assertEqual(jobs.cancel(first['id'])['state'], 'completed')
        self.assertEqual((jobs.directory / (first['id'] + '.json')).stat().st_mode & 0o777, 0o600)
        self.assertEqual(jobs.directory.stat().st_mode & 0o777, 0o700)
        self.assertNotIn('key', result)

    def test_restart_keeps_completed_marks_unknown_and_never_replays(self):
        with tempfile.TemporaryDirectory() as directory:
            atomic_json(Path(directory)/('a'*32+'.json'), {'id':'a'*32,'key':'old','created':time.time(),'state':'running'})
            atomic_json(Path(directory)/('b'*32+'.json'), {'id':'b'*32,'key':'done','created':time.time(),'state':'completed','text':'보존 원문'})
            jobs = TranscriptionJobs(settings_from_env({}), directory, lambda *args: self.fail('automatic replay'))
            try:
                self.assertEqual(jobs.get('a'*32)['state'], 'interrupted')
                self.assertEqual(jobs.get('b'*32)['text'], '보존 원문')
                with self.assertRaises(RuntimeError):
                    TranscriptionJobs(settings_from_env({}), directory)
                self.assertEqual(jobs.get('a'*32)['state'], 'interrupted')
            finally:
                jobs.close()

    def test_progress_and_state_atomic_writes_do_not_share_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            errors = []
            def write(suffix):
                try:
                    for i in range(50):
                        atomic_json(Path(directory)/('same-job.'+suffix), {"kind":suffix,"value":i})
                except Exception as error:
                    errors.append(error)
            threads=[threading.Thread(target=write,args=(suffix,)) for suffix in ['json','progress','result']]
            for thread in threads:thread.start()
            for thread in threads:thread.join()
            self.assertEqual(errors,[])
            for suffix in ['json','progress','result']:
                self.assertEqual(json.loads((Path(directory)/('same-job.'+suffix)).read_text()),{"kind":suffix,"value":49})

    def test_progress_is_based_on_segments_not_elapsed_time(self):
        from stt_jobs import worker
        with tempfile.TemporaryDirectory() as directory:
            result = Path(directory) / 'fixture.result'
            progress = result.with_suffix('.progress')
            settings = settings_from_env({'WHISPER_CPU_THREADS':'24'})
            observed = []
            class Model:
                def __init__(self, *args, **kwargs):
                    self.asserted_threads = kwargs['cpu_threads']
                    observed.append(self.asserted_threads)
                def transcribe(self, *args, **kwargs):
                    def segments():
                        yield SimpleNamespace(text='앞부분', end=25)
                        observed.append(json.loads(progress.read_text())['percent'])
                        yield SimpleNamespace(text='뒷부분', end=100)
                    return segments(), SimpleNamespace(duration=100)
            with patch.dict(sys.modules, {'faster_whisper':SimpleNamespace(WhisperModel=Model)}), patch('sys.stdin', io.StringIO(json.dumps(settings))):
                worker('synthetic-no-audio-file-needed', str(result))
            self.assertEqual(observed, [24,25.0])
            self.assertEqual(json.loads(progress.read_text())['percent'],99)
            self.assertEqual(json.loads(result.read_text())['text'],'앞부분 뒷부분')

    def test_http_is_responsive_during_inference_and_cancel_is_real(self):
        jobs = self.make_jobs()
        server = create_server(None, {**settings_from_env({}), 'port':0}, jobs)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(method, path, body=None):
            connection=http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            connection.request(method,path,body=body)
            response=connection.getresponse(); result=(response.status,json.loads(response.read()));connection.close();return result
        status, result = request('POST','/jobs',b'synthetic audio')
        self.assertEqual(status,202)
        self.assertTrue(request('GET','/health')[1]['busy'])
        self.assertEqual(request('POST','/jobs',b'synthetic audio')[1]['id'],result['id'])
        self.assertEqual(request('POST','/jobs',b'other audio')[0],429)
        self.assertEqual(request('POST','/jobs/'+result['id']+'/cancel')[1]['state'],'cancelled')
        self.assertIsNotNone(self.processes[-1].poll())
        self.assertFalse(request('GET','/health')[1]['busy'])
        self.assertEqual(request('GET','/jobs/'+'f'*32)[0],404)


if __name__ == '__main__':
    unittest.main()
