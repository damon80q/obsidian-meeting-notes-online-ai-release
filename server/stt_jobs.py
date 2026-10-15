"""동시 1건 전사 작업. 인증은 loopback 앞의 Node API에서 검사합니다."""
import fcntl
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path


class JobError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".writing")
    with open(temporary, "w", encoding="utf-8", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
        json.dump(value, stream, ensure_ascii=False)
    os.replace(temporary, path)


class TranscriptionJobs:
    def __init__(self, settings, directory, worker_factory=None):
        self.settings = settings
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        self.instance_lock = open(self.directory / ".lock", "a")
        os.chmod(self.directory / ".lock", 0o600)
        try:
            fcntl.flock(self.instance_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            self.instance_lock.close()
            raise RuntimeError("전사 작업 서버가 이미 실행 중입니다.")
        self.lock = threading.RLock()
        self.records = {}
        self.active = None
        self.process = None
        self.worker_factory = worker_factory or self._start_worker
        for path in self.directory.glob("*.json"):
            if not re.fullmatch(r"[a-f0-9]{32}\.json", path.name):
                continue
            record = json.loads(path.read_text())
            if record["state"] in ("running", "cancelling"):
                record.update(state="interrupted", error="서버가 재시작되어 전사 결과를 확인할 수 없습니다. 자동 재전송하지 않습니다.", finished=time.time())
                atomic_json(path, record)
            self.records[record["id"]] = record

    def close(self):
        if self.active:
            self.cancel(self.active)
        fcntl.flock(self.instance_lock, fcntl.LOCK_UN)
        self.instance_lock.close()

    def _start_worker(self, audio, result):
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker", str(audio), str(result)],
                                   stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            process.stdin.write(json.dumps(self._settings(self.records[audio.stem].get("profile", "accurate"))).encode())
            process.stdin.close()
        except Exception:
            process.kill()
            process.wait()
            raise
        return process

    def _save(self, record):
        atomic_json(self.directory / (record["id"] + ".json"), record)

    def _settings(self, profile):
        settings = dict(self.settings)
        if profile == "fast":
            if not settings.get("fast_model"):
                raise JobError(503, "빠른 전사 모델이 설정되지 않았습니다.")
            settings.update(model=settings["fast_model"], beam_size=settings.get("fast_beam_size", 1), allow_empty=True)
        elif profile == "turbo":
            settings.update(allow_empty=True)
        elif profile != "accurate":
            raise JobError(400, "전사 방식을 확인해 주세요.")
        settings.pop("fast_model", None)
        settings.pop("fast_beam_size", None)
        return settings

    def _public(self, record):
        progress = self.directory / (record["id"] + ".progress")
        try:
            measured = json.loads(progress.read_text()) if progress.exists() else {}
        except (OSError, ValueError):
            measured = {}
        result = {"id": record["id"], "state": record["state"], "elapsedSeconds": int((record.get("finished") or time.time()) - record["created"])}
        result["profile"] = record.get("profile", "accurate")
        for key in ("phase", "percent", "processedSeconds", "totalSeconds"):
            if key in measured:
                result[key] = measured[key]
            elif key in record:
                result[key] = record[key]
        if record["state"] == "completed":
            result.update(phase="completed", percent=100)
        for key in ("text", "error"):
            if key in record:
                result[key] = record[key]
        partial = measured.get("partialText", record.get("partialText"))
        if isinstance(partial, str) and len(partial) <= 30000:
            result["partialText"] = partial
        return result

    def _prune(self):
        for identifier, record in list(self.records.items()):
            if identifier != self.active and time.time() - record.get("finished", record["created"]) > 86400:
                for suffix in (".json", ".audio", ".result", ".progress"):
                    (self.directory / (identifier + suffix)).unlink(missing_ok=True)
                del self.records[identifier]

    def submit(self, raw, profile="accurate"):
        settings = self._settings(profile)
        key = hashlib.sha256(json.dumps(settings, sort_keys=True).encode() + b"\0" + raw).hexdigest()
        with self.lock:
            self._prune()
            for record in self.records.values():
                if record["key"] == key and record["state"] in ("running", "completed"):
                    return self._public(record)
            if self.active:
                raise JobError(429, "다른 녹음을 전사 중입니다. 기존 작업을 기다리거나 해당 작업의 전사 취소를 눌러 주세요.")
            identifier = uuid.uuid4().hex
            record = {"id": identifier, "key": key, "state": "running", "profile": profile, "created": time.time()}
            audio = self.directory / (identifier + ".audio")
            with open(audio, "wb", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
                stream.write(raw)
            self.records[identifier] = record
            try:
                process = self.worker_factory(audio, self.directory / (identifier + ".result"))
            except Exception:
                record.update(state="failed", error="전사 실행기를 시작하지 못했습니다. 자동 재전송하지 않습니다.", finished=time.time())
                audio.unlink(missing_ok=True)
                self._save(record)
                return self._public(record)
            self.active, self.process = identifier, process
            self._save(record)
            threading.Thread(target=self._watch, args=(identifier, process), daemon=True).start()
            return self._public(record)

    def _watch(self, identifier, process):
        process.wait()
        with self.lock:
            record = self.records[identifier]
            if record["state"] not in ("running", "cancelling"):
                return
            if record["state"] == "cancelling":
                record.update(state="cancelled")
            else:
                try:
                    result = json.loads((self.directory / (identifier + ".result")).read_text())
                    if process.returncode != 0 or not isinstance(result.get("text"), str) or (not result["text"].strip() and record.get("profile") not in ("fast", "turbo")) or len(result["text"]) > 30000:
                        raise ValueError("invalid result")
                    record.update(state="completed", text=result["text"])
                except Exception:
                    record.update(state="failed", error="전사에 실패했습니다. 원음은 보관되어 있으며 자동 재전송하지 않습니다.")
            try:
                measured = json.loads((self.directory / (identifier + ".progress")).read_text())
                record.update({key: measured[key] for key in ("phase", "percent", "processedSeconds", "totalSeconds", "partialText") if key in measured})
            except (OSError, ValueError):
                pass
            record["finished"] = time.time()
            if self.active == identifier:
                self.active, self.process = None, None
            self._save(record)
            for suffix in (".audio", ".result", ".progress"):
                (self.directory / (identifier + suffix)).unlink(missing_ok=True)

    def get(self, identifier):
        with self.lock:
            if identifier not in self.records:
                raise JobError(404, "전사 작업을 찾을 수 없습니다. 자동 재전송하지 않습니다.")
            return self._public(self.records[identifier])

    def busy(self):
        with self.lock:
            return self.active is not None

    def cancel(self, identifier):
        with self.lock:
            if identifier not in self.records:
                raise JobError(404, "전사 작업을 찾을 수 없습니다.")
            record = self.records[identifier]
            if record["state"] not in ("running", "cancelling"):
                return self._public(record)
            record["state"] = "cancelling"
            self._save(record)
            process = self.process
        # 화면만 닫지 않습니다. 이 작업의 전사 프로세스 그룹이 종료될 때까지 확인합니다.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=3)
        self._watch(identifier, process)
        return self.get(identifier)


def worker(audio, result):
    from faster_whisper import WhisperModel
    settings = json.load(sys.stdin)
    progress = Path(result).with_suffix(".progress")
    atomic_json(progress, {"phase": "loading", "percent": None})
    model = WhisperModel(settings["model"], device="cpu", compute_type="int8", cpu_threads=settings["cpu_threads"], num_workers=1)
    atomic_json(progress, {"phase": "preparing", "percent": None})
    segments, info = model.transcribe(audio, language="ko", task="transcribe", beam_size=settings["beam_size"], vad_filter=True,
                                   condition_on_previous_text=False, hotwords=settings["hotwords"], initial_prompt=settings["initial_prompt"])
    duration = float(info.duration)
    measured = {"phase": "transcribing", "percent": 0, "processedSeconds": 0, "totalSeconds": round(duration, 3)}
    atomic_json(progress, measured)
    parts = []
    for segment in segments:
        parts.append(segment.text.strip())
        partial = " ".join(parts)
        if len(partial) > 30000:
            raise ValueError("전사문이 30,000자 한도를 넘었습니다.")
        position = min(duration, max(measured["processedSeconds"], float(segment.end)))
        measured.update(processedSeconds=round(position, 3), percent=round(min(99, position / duration * 100), 1) if duration else None, partialText=partial)
        atomic_json(progress, measured)
    atomic_json(Path(result), {"text": " ".join(parts)})


if __name__ == "__main__":
    worker(sys.argv[2], sys.argv[3])
