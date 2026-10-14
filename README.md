# AI 회의록 · 온라인 AI — 외부 배포 준비용

옵시디언에서 회의를 녹음하고 마크다운 회의록·전사문·원음을 보관하는 플러그인입니다. **OpenClaw나 특정 개인 서버가 필요하지 않습니다.** 본인이 처리 서버를 운영하거나 담당자가 제공한 서버를 이용합니다.

현재 **v0.1.0 배포 후보**입니다. 저장소는 비공개 준비본, 설치 파일은 릴리스 초안이며 내부 실제 사용 검증 후 공개합니다. 옵시디언 커뮤니티 플러그인 목록에 등록된 상태는 아닙니다.

## 먼저 볼 문서 — 하나만

**[전체 설치·설정 안내](docs/SETUP.md)**를 봅니다. 서버 설치 → 모델/토큰 → 연결 주소 → 옵시디언 → 녹음 시험 → 재부팅까지 한곳에 있습니다. 기본 서버 폴더는 `~/apps/obsidian-meeting-notes-online-ai-release`이며 자신의 폴더로 바꿔도 됩니다.

## 어떤 버전인가요?

음성은 본인이 운영하는 Whisper 서버에서, 전사 텍스트 정리는 Codex 로그인 또는 선택한 온라인 AI API에서 처리합니다.

설치 ID는 **ai-meeting-notes-online**, 파일은 **ai-meeting-notes-online-0.1.0.zip**(플러그인)과 **ai-meeting-notes-online-server-0.1.0.zip**(서버)입니다. 내부 개발용 이름/설치 폴더와 구분됩니다. Source code ZIP은 플러그인 설치용 ZIP이 아닙니다.

## 사용

녹음 시작 → 녹음 종료·정리 → 일시 제목으로 회의록 자동 저장·열기입니다. 수동 텍스트/파일 재처리는 선택형으로 접혀 있습니다.

회의록은 검토가 필요한 AI 초안입니다. 기존 노트는 덮어쓰지 않습니다. 실패 시 확보한 원음·전사문을 보존합니다. 화자 분리·실시간 전사·장시간 자동 분할·자동 재전송은 지원하지 않습니다.

## 참고용 — 필요할 때만

- [모델/환경 설정](docs/CONFIGURATION.md) — 모델이나 제공자를 바꿀 때
- [오류 해결](docs/TROUBLESHOOTING.md) — 문제가 생겼을 때
- [검증 범위](docs/STATUS.md) — 확인한 것과 미확인 항목
- [배포 후보 업데이트](docs/RELEASE_PROCESS.md) — 개발 담당자용

## 개발 담당자

~~~sh
npm ci
npm run typecheck
npm test
npm run build
npm run package
~~~

실제 .env·data.json·OAuth·API 키·개인 원음·운영 로그는 배포 코드에 넣지 않습니다.
