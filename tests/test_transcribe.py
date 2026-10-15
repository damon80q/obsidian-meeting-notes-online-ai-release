"""모델 다운로드 없는 전사 설정·HTTP 계약 회귀 시험."""
import importlib.util
import json
import threading
import sys
import unittest
import http.client
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

spec = importlib.util.spec_from_file_location("meeting_transcribe", Path(__file__).resolve().parents[1] / "server/transcribe.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TranscriptionTests(unittest.TestCase):
    def start_server(self, fake_model, extra=None):
        settings = module.settings_from_env({})
        settings.update({"port": 0, **(extra or {})})
        server = module.create_server(fake_model, settings)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return "http://127.0.0.1:" + str(server.server_port)

    def test_health_does_not_leak_vocabulary(self):
        url = self.start_server(None, {"hotwords": "private-vocabulary", "initial_prompt": "private-context"})
        connection = http.client.HTTPConnection("127.0.0.1", int(url.rsplit(":", 1)[1]))
        connection.request("GET", "/health")
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()
        self.assertEqual(payload["model"], "large-v3-turbo")
        self.assertEqual(payload["language"], "ko")
        self.assertNotIn("private", json.dumps(payload))

    def test_transcription_uses_korean_vocabulary_and_preserves_result(self):
        calls = []

        class Model:
            def transcribe(self, path, **kwargs):
                calls.append((Path(path).read_bytes(), kwargs))
                return [SimpleNamespace(text="  원문 그대로  ")], None

        url = self.start_server(Model(), {"hotwords": "옵시디언, 코덱스", "initial_prompt": "한국어 회의", "beam_size": 5})
        connection = http.client.HTTPConnection("127.0.0.1", int(url.rsplit(":", 1)[1]))
        connection.request("POST", "/transcribe", body=b"synthetic-audio")
        response = connection.getresponse()
        self.assertEqual(json.loads(response.read()), {"text": "원문 그대로"})
        connection.close()
        self.assertEqual(calls[0][0], b"synthetic-audio")
        options = calls[0][1]
        self.assertEqual(options["language"], "ko")
        self.assertEqual(options["task"], "transcribe")
        self.assertEqual(options["hotwords"], "옵시디언, 코덱스")
        self.assertFalse(options["condition_on_previous_text"])
        self.assertTrue(options["vad_filter"])

    def test_empty_upload_is_rejected_without_model_call(self):
        class Model:
            def transcribe(self, *args, **kwargs):
                raise AssertionError("empty upload must not reach model")

        url = self.start_server(Model())
        connection = http.client.HTTPConnection("127.0.0.1", int(url.rsplit(":", 1)[1]))
        connection.request("POST", "/transcribe", body=b"")
        response = connection.getresponse()
        response.read()
        connection.close()
        self.assertEqual(response.status, 413)


if __name__ == "__main__":
    unittest.main()
