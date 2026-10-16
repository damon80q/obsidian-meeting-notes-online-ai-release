# 전체 설치·설정 안내 · 온라인 AI

이 문서가 주 설치 안내입니다. 다른 설치 파일을 순서대로 읽을 필요가 없습니다.

**이 플러그인은 처리 서버가 필요합니다.** 서버 주소와 접속 토큰을 받았다면 서버를 직접 설치하지 않아도 됩니다. 받은 주소가 없다면 본인 또는 담당자가 서버부터 준비해야 합니다.

용어는 두 가지만 구분하세요. **전사 = 녹음한 말을 글로 옮기기**, **정리 = 그 글로 회의록 만들기**입니다. 기본 구성에서 음성은 지정한 서버의 Whisper가, 회의록 정리는 온라인 AI가 처리합니다.

## 설치 순서

- 서버를 이미 제공받은 옵시디언 사용자: **5 플러그인 설치**부터 봅니다.
- 서버도 준비하는 사용자: **1 → 2 → 3 → 4 → 5 → 6** 순서로 봅니다.
- 재부팅·자동실행은 **7**, 모델 선택·문제 해결은 끝의 참고 문서를 필요할 때만 봅니다.

설치 파일은 [v0.1.1 다운로드 페이지](https://github.com/damon80q/obsidian-meeting-notes-online-ai-release/releases/tag/v0.1.1)의 **Assets(첨부 파일)**에 있습니다.

- **옵시디언 사용자용:** `ai-meeting-notes-online-0.1.1.zip`
- **서버를 직접 준비하는 담당자용:** `ai-meeting-notes-online-server-0.1.1.zip`도 함께 받습니다.
- **Source code (zip/tar.gz):** 개발 소스이며 플러그인 폴더에 그대로 넣는 설치 파일이 아닙니다.

## 1. 서버 컴퓨터와 설치 폴더

처리 서버는 Linux 또는 macOS에 Node.js 22 이상·Python 3.12를 준비합니다. Whisper는 CPU/int8로 동작하며 Apple GPU 최적화 구현은 아닙니다. Windows/macOS 옵시디언은 클라이언트로 사용합니다. Windows 서버 설치와 모바일 전체 흐름은 미검증입니다.

기본 폴더는 `~/apps/obsidian-meeting-notes-online-ai-release`입니다. 다른 위치로 설치해도 됩니다. 특정 개인의 서버나 폴더는 필요하지 않습니다. 다른 앱의 모델·로그인·네트워크를 바꾸지 않습니다.

소스 설치:

~~~sh
mkdir -p ~/apps
git clone https://github.com/damon80q/obsidian-meeting-notes-online-ai-release.git ~/apps/obsidian-meeting-notes-online-ai-release
cd ~/apps/obsidian-meeting-notes-online-ai-release
~~~

서버 ZIP으로 설치하면 압축을 풀어 나온 `ai-meeting-notes-online-server` 폴더를 위 설치 위치로 옮깁니다. 이후 명령은 **실제 설치 폴더 안**에서 실행합니다. 서버를 이미 제공받았다면 서버 ZIP은 필요 없으며 플러그인 ZIP만 설치합니다.

## 2. Python 환경·토큰

~~~sh
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
test -f .env || cp .env.example .env
chmod 600 .env
~~~

requirements는 requests 직접 선언·호환 av 버전 제약을 포함합니다. 기존 .env를 예제로 덮어쓰지 않습니다. 최초 빈 접속 토큰을 준비합니다.

~~~sh
python3 - <<'PYTOKEN'
from pathlib import Path
import re, secrets
p=Path('.env')
t=p.read_text()
t=re.sub(r'^SERVER_TOKEN=$', 'SERVER_TOKEN='+secrets.token_urlsafe(32), t, flags=re.M)
p.write_text(t)
PYTOKEN
nano .env
~~~

토큰은 24자 이상의 무작위 앱 접속 값입니다. 서버와 플러그인에 같은 값을 넣습니다. AI API 키·OAuth 토큰과 다릅니다. 실제 값은 공개하지 않습니다.

## 3. 텍스트 AI 준비

기본은 공식 Codex CLI의 ChatGPT 로그인입니다. API 구성은 참고용 [모델 설정](CONFIGURATION.md)을 봅니다. API는 구독과 별도 과금이며 사용자가 선택한 경우에만 허용합니다.

~~~sh
npm install -g @openai/codex
mkdir -p "$HOME/.local/share/ai-meeting-notes-online-codex"
chmod 700 "$HOME/.local/share/ai-meeting-notes-online-codex"
env CODEX_HOME="$HOME/.local/share/ai-meeting-notes-online-codex" codex login -c 'cli_auth_credentials_store="file"' --device-auth
~~~

.env의 CODEX_HOME에는 로그인과 같은 **절대 경로**를 넣습니다. .env 안의 `~`·`$HOME`은 자동 확장되지 않습니다. 아래는 해당 줄만 실제 사용자 경로로 준비합니다.

~~~sh
python3 - <<'PYHOME'
from pathlib import Path
import re
p=Path('.env')
t=p.read_text()
home=Path.home()/'.local/share/ai-meeting-notes-online-codex'
t=re.sub(r'^CODEX_HOME=.*$', 'CODEX_HOME='+str(home), t, flags=re.M)
p.write_text(t)
PYHOME
~~~

MODE=codex와 CODEX_MODEL을 확인합니다. 예제 모델이 모든 계정에서 지원되는 것은 아니므로 본인 CLI가 제공하는 실제 모델 ID를 넣습니다. 기존 다른 앱의 인증 파일을 복사하거나 로그아웃하지 않습니다. 로그인 상태와 실제 분석 성공은 별도입니다.

음성 전사는 Codex가 아니라 아래 Whisper가 맡습니다. Codex 사용도 계정 한도를 사용할 수 있습니다.

## 4. Whisper·정리 서버 실행

이미 실행 중이면 다시 켜지 않습니다. 정리 서버 상태부터 확인합니다.

~~~sh
curl --fail --max-time 10 http://127.0.0.1:8789/health
~~~

터미널 A — Whisper:

~~~sh
cd ~/apps/obsidian-meeting-notes-online-ai-release
.venv/bin/python server/transcribe.py
~~~

Whisper 작업 서버의 전사 포트는 **127.0.0.1:8790**입니다. 최초 실제 전사 요청 때 모델 다운로드·로딩이 필요할 수 있습니다. 준비/health 응답만으로 모델 전사까지 확인한 것은 아닙니다.

Whisper는 음성을 글로 바꾸는 AI입니다. 이 서버는 프로젝트 .env의 기본 모델 `large-v3-turbo`(앱에서 ‘터보’로 표시), CPU·용어 힌트 설정을 읽습니다. 준비 메시지와 http://127.0.0.1:8790/health를 확인합니다.

터미널 B — 정리 서버:

~~~sh
cd ~/apps/obsidian-meeting-notes-online-ai-release
node --env-file=.env server/index.mjs
~~~

수동 실행에서는 두 터미널을 열어 둡니다. 정상인 다른 앱이나 모든 node/Python을 종료하지 않습니다.

Linux는 `bash scripts/start-independent.sh`로 별도 임시 사용자 서비스에서 정리 서버를 실행할 수도 있습니다. 이 helper는 같은 이름의 영구/임시 서비스가 active면 중복 실행하지 않고 **부팅 자동실행은 등록하지 않습니다.**

## 5. 플러그인 설치·주소·설정

### 서버 주소를 먼저 정합니다

같은 처리 컴퓨터의 옵시디언이라면 **http://127.0.0.1:8789**입니다. 다른 기기에 localhost를 넣으면 그 기기 자신을 가리킵니다.

다른 기기는 담당자가 제공한 **HTTPS 주소**를 사용합니다. Tailscale Serve 또는 HTTPS 역방향 프록시로 정리 서버 **8789**만 연결할 수 있습니다. Whisper 8790나 Ollama11434를 클라이언트에 직접 공개하지 않습니다. 기존 프록시·방화벽을 조회하고 필요한 설정만 추가합니다.

온라인 데스크톱은 신뢰하는 사설 IPv4 HTTP도 지원합니다. 필요할 때 HOST=127.0.0.1은 유지하고 LAN_HOST에 본인 서버의 내부 IP를 추가한 뒤 정리 서버만 재시작합니다. 방화벽은 해당 내부망에서 정리 포트만 허용합니다. HTTP는 전송 암호화가 없고 모바일·외부에서는 HTTPS를 사용합니다. 인터넷 포트포워딩용 설정이 아닙니다.

### 옵시디언 설치

앱을 완전히 종료합니다. 설치 ZIP의 **ai-meeting-notes-online** 폴더를 프로그램 폴더가 아닌 **보관함 폴더**의 `.obsidian/plugins/` 안에 넣습니다.

~~~text
내_보관함/
  .obsidian/
    plugins/
      ai-meeting-notes-online/
        main.js
        manifest.json
        styles.css
~~~

숨김 폴더는 macOS Finder에서 ⌘⇧., Windows 탐색기에서 숨긴 항목 표시로 확인합니다. 앱을 다시 열고 커뮤니티 플러그인에서 **AI 회의록 · 온라인 AI**를 활성화합니다.

### 플러그인 설정

- 처리 방식: 정리 서버. 데모는 AI 없이 서식만 만드는 시험입니다.
- 정리 서버 주소: 위에서 정한 주소. 끝에 **/health를 붙이지 않습니다.**
- 서버 접속 토큰: 서버 .env의 SERVER_TOKEN과 같은 값.
- 녹음 후 회의록 자동 작성: 켜기. 원하면 끄고 결과를 편집해 저장합니다.
- 저장 폴더: 보관함 안의 상대 경로. 새 기본값은 회의록-온라인AI입니다.

플러그인에 OAuth·AI API 키를 넣지 않습니다. 주소에 토큰·쿼리·해시도 넣지 않습니다.

## 6. 짧게 녹음·저장 시험

명령 팔레트에서 회의 정리 시작을 엽니다. 화면의 전송 대상을 확인하고 동의 항목을 선택합니다. 마이크+컴퓨터 소리는 데스크톱/OS가 지원하는 경우에만 사용하며, 대면회의는 마이크만 선택합니다. 컴퓨터 소리·화면 공유·마이크 권한을 확인하고, 권한을 거절하면 자동으로 마이크만 녹음하지 않습니다. 영상은 녹음 파일에 넣지 않습니다.

### 어떤 전사 방식을 고르면 되나요?

처음에는 **기본형**, 즉 앱의 **터보 · 녹음 중 구간 전사 (약30초)**를 선택하세요. ‘터보’는 기본 음성인식 AI의 모델 이름입니다. 녹음 중 약 30초 분량씩 말한 내용을 글로 옮깁니다. **약 30초는 음성을 나누는 길이이며 처리 완료 시간은 아닙니다.**

다른 선택은 필요할 때만 사용합니다.

- **경량형 — 앱의 ‘빠르게’:** 더 작은 `small`(스몰) 음성인식 모델로 서버 부담을 줄이는 선택입니다. 인식 정확도가 낮아질 수 있고 서버 담당자의 추가 준비가 필요합니다. 비활성화되어 있다면 기본형으로 시작하세요.
- **종료 후 전체 처리 — 앱의 ‘정밀하게’:** 녹음이 끝난 뒤 전체 음성을 처리합니다. 기본 설정에서는 기본형과 **같은 모델**을 쓰며, 더 큰 별도 모델로 바뀌는 것이 아닙니다.

이 선택은 회의록을 요약하는 온라인 AI의 종류나 요금제를 바꾸지 않습니다. [세 방식의 자세한 차이](TRANSCRIPTION.md)를 참고하세요.

### 녹음부터 회의록 저장까지

기본형·경량형의 순서는 녹음 시작 → 녹음 중 전사문 누적 → 녹음 종료·정리 → 회의록 자동 저장·열기입니다. 종료하면 **완료된 구간은 재사용**하고 아직 대기 중인 구간과 마지막 남은 음성만 처리한 뒤 전체 전사문을 AI가 정리합니다. 서버가 느리면 종료 후에도 기다리며 처음부터 전체를 다시 전사하는 것이 아닙니다. 전체 원음은 한 파일로 보관합니다. ‘종료 후 전체 처리’를 선택한 경우에만 종료 후 전체 음성인식을 시작합니다.

로딩 스피너·현재 단계·전사 취소를 표시합니다. 완료·오류 시 표시가 해제되며 처리 중 중복 실행을 막습니다. 수동 텍스트/파일 재처리와 미완료 구간 계속은 접힌 영역에서 선택합니다. 숫자 진행률·예상시간은 표시하지 않습니다.

먼저 본인 음성 약1분으로 시험하고 녹음 중 전사문·최종 일정/담당·회의록 저장·원음 링크·재생을 확인합니다. health 응답은 이 전체 시험을 대신하지 않습니다. 음성 최대24MB·녹음최대60분·텍스트30,000자 제한은 유지합니다. 화자 분리·즉시 자막·실제 Zoom·장시간/모바일 전체 흐름은 미검증입니다. [전사 방식과 복구](TRANSCRIPTION.md)를 참고하세요.

## 7. 재부팅·업데이트

설치·모델·.env·로그인은 디스크에 남습니다. 수동 프로세스는 재부팅 후 다시 켜야 하며 재설치/재로그인을 반복하지 않습니다. 서버를 설치했다고 자동실행이 등록되는 것은 아닙니다.

### Linux의 선택형 자동실행 예시

먼저 수동 시험을 통과하고 기존 같은 이름 단위를 읽습니다. 기본 폴더를 바꾸었다면 아래의 `%h/apps/obsidian-meeting-notes-online-ai-release`도 바꿉니다. `%h`는 systemd에서 해당 사용자 홈입니다. node·codex 실행 경로는 `command -v`로 확인하고 아래 PATH를 설치 위치에 맞춥니다.

`~/.config/systemd/user/ai-meeting-notes-online-stt.service`:

~~~ini
[Unit]
Description=AI Meeting Notes online Whisper
[Service]
WorkingDirectory=%h/apps/obsidian-meeting-notes-online-ai-release
ExecStart=%h/apps/obsidian-meeting-notes-online-ai-release/.venv/bin/python server/transcribe.py
UMask=0077
Restart=on-failure
RestartSec=5
[Install]
WantedBy=default.target
~~~

`~/.config/systemd/user/ai-meeting-notes-online.service`:

~~~ini
[Unit]
Description=AI Meeting Notes online API
Wants=ai-meeting-notes-online-stt.service
After=ai-meeting-notes-online-stt.service
[Service]
WorkingDirectory=%h/apps/obsidian-meeting-notes-online-ai-release
Environment=PATH=/usr/local/bin:/usr/bin:/bin:%h/.local/bin:%h/.npm-global/bin
ExecStart=/usr/bin/env node --env-file=.env server/index.mjs
UMask=0077
Restart=on-failure
RestartSec=5
[Install]
WantedBy=default.target
~~~

수동으로 켜 둔 **이 앱의 두 프로세스만** 원래 터미널에서 Ctrl+C로 종료합니다.

임시 helper를 사용했다면 `systemctl --user stop ai-meeting-notes-online-runtime.service`로 그 서비스만 멈추고 영구 서비스와 중복 실행하지 않습니다.

~~~sh
systemctl --user daemon-reload
systemctl --user enable --now ai-meeting-notes-online-stt.service ai-meeting-notes-online.service
systemctl --user status ai-meeting-notes-online-stt.service ai-meeting-notes-online.service --no-pager
loginctl show-user "$USER" -p Linger
~~~

로그아웃 후에도 실행하려면 관리자가 해당 사용자의 linger를 확인합니다. 이 파일은 일반 템플릿이고 실제 부팅 검증을 했다는 뜻은 아닙니다. macOS는 systemd가 없으므로 이 단위를 사용하지 않으며 launchd 등으로 별도 준비합니다.

### v0.1.0 → v0.1.1 업데이트

**서버 제공 사용자는 플러그인만 업데이트**합니다. 직접 운영하는 담당자는 아래 서버 업데이트를 먼저 수행합니다. 기존 서버는 이번 구간 전사·작업 조회/취소 경로를 지원하지 않으므로 새 플러그인만으로 새 기능을 쓸 수 없습니다.

1. 진행 중 녹음과 전사 작업을 마친 뒤 코드·`.env`·인증·기존 사용자 자료를 백업합니다.
2. 서버 담당자는 새 서버 ZIP을 **별도 폴더에 먼저 풀어** 확인합니다. `server/` 코드와 필요한 스크립트/문서만 기존 설치에 반영합니다. 특히 `server/stt_jobs.py`·`server/stt_proxy.mjs`를 누락하지 않습니다. 기존 `.env`·가상환경·모델·인증·서비스 정의는 덮어쓰지 않습니다. `.env.example`은 참고용입니다.
3. 터보 구간 전사에는 기존 `WHISPER_MODEL=large-v3-turbo`와 beam 설정을 그대로 사용합니다. `WHISPER_FAST_MODEL`은 small 빠른 모드가 필요한 경우에만 추가합니다. CPU 스레드는 자신의 서버에 맞춰 비교하고 다른 서버의 수치를 그대로 복사하지 않습니다.
4. **이 앱의 Whisper와 정리 서버만** 기존 운영 방식으로 재시작합니다. 위 사용자 서비스 예시를 사용했다면 `systemctl --user restart ai-meeting-notes-online-stt.service ai-meeting-notes-online.service`입니다. 다른 이름의 서비스나 다른 앱은 변경하지 않습니다.
5. 정리 서버 `/health`의 `audioJobs=true`·`audioTurbo=true`, Whisper `/health`의 `jobs=true`·`turboChunks=true`를 확인합니다. 이후 짧은 실제 녹음으로 전체 처리를 확인합니다.
6. 옵시디언을 종료하고 같은 **ai-meeting-notes-online** 폴더에서 `main.js`·`manifest.json`·`styles.css`만 교체합니다. **기존 `data.json`·원음·전사·회의록은 보존**하고 앱을 다시 엽니다. 주소·토큰·저장 폴더·자동 저장 설정은 유지됩니다.

내부판과 공개판의 ID는 다르므로 내부 설치 폴더를 덮어쓰지 않습니다. 두 앱으로 같은 회의를 동시에 처리하지 않습니다. 이전 릴리즈는 보존합니다. 되돌릴 때도 백업한 변경 파일만 복원하며 사용자 자료와 작업 캐시는 삭제하지 않습니다.

## 참고용 — 필요한 경우만

- [전사 방식과 복구](TRANSCRIPTION.md)
- [모델과 환경 설정](CONFIGURATION.md)
- [오류 해결](TROUBLESHOOTING.md)
- [확인한 검증 범위](STATUS.md)

### 이전 기본 폴더명 전환

저장된 설정이 이전 기본값 `회의록-상용` 또는 `회의록-AI-온라인`인 경우 `회의록-온라인AI`로 전환합니다. 앞으로 만드는 회의록에 적용하며 기존 파일을 자동 이동하지 않습니다. 별도로 지정한 저장 폴더는 보존합니다.
