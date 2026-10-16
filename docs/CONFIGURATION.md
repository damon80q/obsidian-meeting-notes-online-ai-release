# 참고 · 모델과 환경 설정 · 온라인 AI

주 설치 문서는 [SETUP.md](SETUP.md)입니다. 이 문서는 다른 모델/제공자를 선택할 때만 읽습니다.

- 서버 값: 설치 폴더 .env. 실제 값은 공개하지 않습니다.
- SERVER_TOKEN: 24자 이상 앱 접속 토큰, 플러그인과 같게 사용.
- HOST: 기본 127.0.0.1 / PORT: 정리 서버 8789.
- STT_URL: 서버가 접근하는 Whisper http://127.0.0.1:8790. 옵시디언에 넣는 주소가 아닙니다.
- 변경 후 정리 서버를 재시작하며 전사 모델 관련 변경은 Whisper도 재시작합니다.

## Codex 로그인

MODE=codex, CODEX_MODEL은 실제 계정이 지원하는 ID, CODEX_HOME은 전용 로그인과 같은 절대 경로입니다. 예제의 모델이 모든 계정에 제공된다는 뜻은 아닙니다. .env에서 ~·$HOME이 자동 확장되지 않습니다. 같은 계정이면 사용 한도를 공유할 수 있습니다. Codex는 텍스트를 정리하며 음성 전사는 Whisper가 담당합니다.

## 선택형 API

OpenAI는 MODE=openai·OPENAI_API_KEY·OPENAI_MODEL, Anthropic은 MODE=anthropic·ANTHROPIC_API_KEY·ANTHROPIC_MODEL을 입력합니다. API 과금을 선택했을 때만 ALLOW_PAID_API=true로 설정합니다. API는 구독과 별도 과금이고 실제 구조화 출력 계약을 지원하는 모델이어야 합니다. 실패 시 자동으로 다른 모델을 호출하지 않습니다.

기본 STT_PROVIDER=local은 음성을 처리 서버 Whisper로만 보냅니다. 선택형 STT_PROVIDER=openai는 음성도 OpenAI에 전송하며 OPENAI_API_KEY와 실제 TRANSCRIPTION_MODEL을 지정합니다. 키와 OAuth는 서버에만 저장합니다.

## 음성인식 모델

- `large-v3-turbo`: 기본 모델입니다. 녹음 중 구간 전사와 종료 후 전체 전사에 사용합니다.
- `small`: 서버 부담을 줄이는 선택형 경량 모델입니다. 기본 모델보다 인식 정확도가 낮아질 수 있습니다.

모두 음성을 글로 옮기는 Whisper 모델이며 회의록 정리 AI와 별개입니다. 앱에서의 선택 방법은 [전사·복구 안내](TRANSCRIPTION.md)를 참고하세요.

## Whisper·네트워크

Whisper는 .env의 WHISPER_MODEL(large-v3-turbo), CPU 스레드·beam·선택형 hotwords/짧은 문맥을 읽습니다. 터보 구간과 종료 후 전체 전사는 같은 정밀 모델/beam을 사용합니다. 기본 CPU 스레드는4이고 서버별 실측 후 조정합니다. 용어 힌트에 사실 추가나 원문 치환 명령을 넣지 않습니다.

LAN_HOST는 선택형 사설 IPv4이며 비워 두면 loopback만 사용합니다. loopback의 HTTPS 프록시와 내부 IP를 함께 쓸 수 있고 같은 토큰/동시성 검사를 공유합니다. 사설 HTTP는 PC에서만, 외부/모바일은 HTTPS를 사용합니다.

## 선택형 경량 모델(small)·작업 캐시

기본형(앱의 ‘터보’)에는 기본 모델 외에 추가 모델이 필요 없습니다. 경량형(앱의 ‘빠르게’)은 서버에 `WHISPER_FAST_MODEL=small` 또는 준비한 한국어 지원 다국어 small 모델의 경로, `WHISPER_FAST_BEAM_SIZE=1`을 설정해야 선택할 수 있습니다. 첫 요청의 모델 다운로드·로딩은 별도입니다. `.en` 영어 전용 모델은 사용하지 않습니다. Node와 Python이 같은 `.env`를 읽게 하고 두 서버를 다시 시작합니다. 서버의 기존 기본 모델·beam은 바꾸지 않습니다. beam은 음성인식 후보를 탐색하는 설정이며, 일반 사용자가 모드를 쓰기 위해 조정할 필요는 없습니다.

작업은 동시1건이며 완료 결과·작업 ID를 서버 사용자의 `~/.local/state/meeting-notes-transcriptions`에 보관합니다. 별도 설치를 격리해야 하면 Python 실행 환경에 `STT_STATE_DIR`을 다른 전용 절대 경로로 지정합니다. 이 디렉터리는 원음/전사문을 포함할 수 있으므로 GitHub에 올리거나 일반 로그로 공유하지 않습니다. 정리·백업은 진행 중 작업이 없는 상태에서 담당자가 수행합니다.

선택형 OpenAI 음성 API는 이번 로컬 터보 구간 전사·조회/취소 대상이 아닙니다. 실패 시 유료 API나 다른 모델로 자동 전환하지 않습니다.
