"""한국어 회의용 CPU 전사 서버. 음성·용어·인증정보를 일반 로그에 출력하지 않습니다."""
import json
import os
import tempfile
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from dotenv import load_dotenv
from faster_whisper import WhisperModel


def settings_from_env(source=None):
    source = os.environ if source is None else source

    def number(name, default, low, high):
        value = int(source.get(name, default))
        if not low <= value <= high:
            raise ValueError(name + " 설정 범위를 확인해 주세요.")
        return value

    return {
        # 한국어를 지원하는 다국어 모델입니다. .en 전용 모델은 사용하지 않습니다.
        "model": source.get("WHISPER_MODEL", "large-v3-turbo"),
        "port": number("STT_PORT", 8790, 1, 65535),
        "cpu_threads": number("WHISPER_CPU_THREADS", 4, 1, 12),
        "beam_size": number("WHISPER_BEAM_SIZE", 5, 1, 10),
        # 고유명사·전문용어는 선택 사항입니다. 임의 단어 치환이나 원문 수정은 하지 않습니다.
        "hotwords": source.get("WHISPER_HOTWORDS", "").strip() or None,
        "initial_prompt": source.get("WHISPER_INITIAL_PROMPT", "").strip() or None,
    }


def create_server(model, settings):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send_json(self, code, data):
            payload = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path != "/health":
                self.send_error(404)
                return
            # 기동 모델만 보여 줍니다. 개인 용어·프롬프트·토큰은 응답하지 않습니다.
            self.send_json(200, {
                "model": settings["model"], "language": "ko",
                "device": "cpu", "computeType": "int8",
                "cpuThreads": settings["cpu_threads"], "beamSize": settings["beam_size"],
            })

        def do_POST(self):
            if self.path != "/transcribe":
                self.send_error(404)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.send_error(400)
                return
            if size <= 0 or size > 24 * 1024 * 1024:
                self.send_error(413)
                return
            name = None
            try:
                raw = self.rfile.read(size)
                if len(raw) != size:
                    raise ValueError("incomplete upload")
                with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as audio:
                    audio.write(raw)
                    name = audio.name
                # 실제 한국어를 전사하며 번역하지 않습니다.
                # 문맥 반복 전파를 끄고 VAD로 무음 구간을 걸러 냅니다.
                segments, _ = model.transcribe(
                    name, language="ko", task="transcribe",
                    beam_size=settings["beam_size"], vad_filter=True,
                    condition_on_previous_text=False,
                    hotwords=settings["hotwords"], initial_prompt=settings["initial_prompt"],
                )
                text = " ".join(s.text.strip() for s in segments)
                self.send_json(200, {"text": text})
            except Exception:
                self.send_error(502, "Local transcription failed")
            finally:
                if name:
                    os.unlink(name)

    # 외부 공개하지 않습니다. 맥은 인증이 있는 Node 서버를 통해서만 요청합니다.
    return HTTPServer(("127.0.0.1", settings["port"]), Handler)


def main():
    # 별도 SSH 창에서도 Node와 같은 프로젝트 .env를 읽습니다.
    # systemd 등에서 명시한 환경변수는 .env보다 우선하며 개인 설정은 로그에 출력하지 않습니다.
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
    settings = settings_from_env()
    print("Whisper 모델 로딩 중 (" + settings["model"] + " · 최초 실행 시 다운로드)", flush=True)
    model = WhisperModel(
        settings["model"], device="cpu", compute_type="int8",
        cpu_threads=settings["cpu_threads"], num_workers=1,
    )
    server = create_server(model, settings)
    print("Whisper 음성 전사 서버 준비됨 (127.0.0.1:" + str(server.server_port)
          + " · " + settings["model"] + " · CPU/int8)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
