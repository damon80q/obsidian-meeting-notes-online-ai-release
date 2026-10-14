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

## Whisper·네트워크

Whisper는 .env의 WHISPER_MODEL(large-v3-turbo), CPU 스레드·beam·선택형 hotwords/짧은 문맥을 읽습니다. 용어 힌트에 사실 추가나 원문 치환 명령을 넣지 않습니다.

LAN_HOST는 선택형 사설 IPv4이며 비워 두면 loopback만 사용합니다. loopback의 HTTPS 프록시와 내부 IP를 함께 쓸 수 있고 같은 토큰/동시성 검사를 공유합니다. 사설 HTTP는 PC에서만, 외부/모바일은 HTTPS를 사용합니다.
