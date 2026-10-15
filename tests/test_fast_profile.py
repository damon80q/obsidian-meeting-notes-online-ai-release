"""빠른 전사/정밀 전사 분리, 무음·부분 결과·기존 캐시 호환 검증."""
import hashlib,json,sys,tempfile,time,unittest,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from stt_jobs import TranscriptionJobs,JobError,atomic_json
from transcribe import settings_from_env
class FastTests(unittest.TestCase):
 def make(self,text=''):
  temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
  def factory(audio,result):
   return subprocess.Popen([sys.executable,'-c','import json,sys,time;time.sleep(.05);open(sys.argv[1],"w").write(json.dumps({"text":sys.argv[2]}))',str(result),text],start_new_session=True)
  jobs=TranscriptionJobs(settings_from_env({'WHISPER_FAST_MODEL':'/test/small'}),temporary.name,factory);self.addCleanup(jobs.close);return jobs
 def finish(self,jobs,identifier):
  until=time.monotonic()+3
  while time.monotonic()<until:
   result=jobs.get(identifier)
   if result['state']!='running':return result
   time.sleep(.01)
  self.fail('timeout')
 def test_fast_profile_and_accurate_settings_separate_without_mutating_baseline(self):
  j=self.make('공개 원문');before=dict(j.settings)
  self.assertEqual(j._settings('fast')['model'],'/test/small');self.assertEqual(j._settings('fast')['beam_size'],1)
  self.assertEqual(j._settings('accurate')['model'],'large-v3-turbo');self.assertNotIn('fast_model',j._settings('accurate'));self.assertEqual(j.settings,before)
  a=j.submit(b'same','accurate');self.finish(j,a['id']);b=j.submit(b'same','fast');self.assertNotEqual(a['id'],b['id']);self.finish(j,b['id'])
 def test_confirmed_silence_is_valid_only_for_fast_profile(self):
  j=self.make('');fast=self.finish(j,j.submit(b'silence','fast')['id']);self.assertEqual(fast['state'],'completed');self.assertEqual(fast['text'],'')
  accurate=self.finish(j,j.submit(b'silence','accurate')['id']);self.assertEqual(accurate['state'],'failed')
 def test_partial_text_survives_cancel(self):
  j=self.make('원문');a=j.submit(b'audio','fast');progress=j.directory/(a['id']+'.progress');atomic_json(progress,{'partialText':'보존할 앞부분'})
  r=j.get(a['id']);self.assertEqual(r['partialText'],'보존할 앞부분');j.cancel(a['id']);self.assertEqual(j.get(a['id']).get('partialText'),'보존할 앞부분')
 def test_previous_accurate_cache_key_is_unchanged(self):
  j=self.make('원문');old={k:v for k,v in j.settings.items() if k not in ('fast_model','fast_beam_size')};raw=b'legacy bytes'
  expected=hashlib.sha256(json.dumps(old,sort_keys=True).encode()+b'\0'+raw).hexdigest();a=j.submit(raw);self.assertEqual(j.records[a['id']]['key'],expected);self.finish(j,a['id'])
 def test_unconfigured_fast_does_not_fall_back_to_other_model(self):
  j=self.make();j.settings['fast_model']=None
  with self.assertRaises(JobError):j.submit(b'audio','fast')
 def test_turbo_reuses_accurate_model_beam_without_mutation_or_legacy_cache_collision(self):
  j=self.make('한국어 원문');before=dict(j.settings)
  settings=j._settings('turbo');baseline=j._settings('accurate')
  self.assertEqual(settings['model'],baseline['model']);self.assertEqual(settings['beam_size'],5);self.assertTrue(settings.pop('allow_empty'));self.assertEqual(settings,baseline);self.assertEqual(j.settings,before)
  a=self.finish(j,j.submit(b'public-same','accurate')['id']);b=self.finish(j,j.submit(b'public-same','turbo')['id']);self.assertNotEqual(a['id'],b['id']);self.assertEqual(b['profile'],'turbo');self.assertEqual(j.submit(b'public-same','turbo')['id'],b['id'])
 def test_turbo_silence_finishes_and_does_not_disable_accurate_silence_check(self):
  j=self.make('');self.assertEqual(self.finish(j,j.submit(b'silent','turbo')['id'])['state'],'completed');self.assertEqual(self.finish(j,j.submit(b'silent','accurate')['id'])['state'],'failed')
if __name__=='__main__':unittest.main()
