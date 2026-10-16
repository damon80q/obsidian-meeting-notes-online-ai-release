# AI 회의록 · 온라인 AI

옵시디언에서 회의를 녹음하고, 전사문과 요약·결정사항·할 일이 담긴 회의록을 마크다운으로 저장합니다.

[다운로드](https://github.com/damon80q/obsidian-meeting-notes-online-ai-release/releases/tag/v0.1.1) · [설치 안내](docs/SETUP.md)

## 주요 기능

- 마이크 또는 마이크+컴퓨터 소리 녹음
- 녹음 중 구간 전사와 종료 후 회의록 정리
- 원본 녹음·전사문·회의록 저장
- 미완료 구간 이어받기·전사 취소·보관 녹음 다시 정리

음성은 지정한 서버의 Whisper가 글로 옮기고, 온라인 AI가 그 글을 회의록으로 정리합니다. 플러그인과 처리 서버가 함께 필요합니다.

## 설치

[v0.1.1 릴리즈](https://github.com/damon80q/obsidian-meeting-notes-online-ai-release/releases/tag/v0.1.1)의 **Assets**에서 설치 파일을 받습니다.

- **서버 주소와 접속 토큰을 받은 경우:** [플러그인 ZIP](https://github.com/damon80q/obsidian-meeting-notes-online-ai-release/releases/download/v0.1.1/ai-meeting-notes-online-0.1.1.zip)을 받아 [플러그인 설치](docs/SETUP.md#5-플러그인-설치주소설정)부터 진행합니다.
- **서버를 직접 준비하는 경우:** [서버 ZIP](https://github.com/damon80q/obsidian-meeting-notes-online-ai-release/releases/download/v0.1.1/ai-meeting-notes-online-server-0.1.1.zip)도 받고 [설치 안내](docs/SETUP.md)를 따릅니다.
- **v0.1.0 사용 중인 경우:** [업데이트 순서](docs/SETUP.md#v010--v011-업데이트)를 확인합니다. 서버 코드도 함께 업데이트해야 합니다.

커뮤니티 플러그인 목록에는 아직 등록되지 않아 ZIP으로 직접 설치합니다. `Source code`는 플러그인 설치 파일이 아닙니다.

기존 플러그인은 `main.js`·`manifest.json`·`styles.css`만 교체하고, 설정 파일 `data.json`과 녹음·노트는 보존합니다.

## 사용 방법

1. 명령 팔레트에서 **회의 정리 시작**을 엽니다.
2. 전송 대상을 확인하고, **마이크만** 또는 **마이크+컴퓨터 소리**를 선택합니다.
3. 기본 전사 방식으로 녹음을 시작합니다. 처리된 전사문이 차례로 표시됩니다.
4. **녹음 종료·정리**를 누르면 남은 음성을 처리한 뒤 회의록을 만듭니다.
5. 저장된 회의록의 이름·숫자·담당·일정을 검토합니다.

기본 방식은 녹음 중 약 30초 분량씩 전사하며, 종료할 때 완료 구간을 재사용합니다. 서버 처리 속도에 따라 종료 후에도 기다릴 수 있습니다. 전사 방식 변경과 중단된 작업 복구는 [전사·복구 안내](docs/TRANSCRIPTION.md)를 참고하세요.

원본 녹음은 한 파일로 보관하고, 회의록은 기본적으로 `회의록-온라인AI` 폴더에 저장합니다. 사용자 지정 폴더와 기존 자료는 유지합니다.

컴퓨터 소리 녹음은 데스크톱의 OS 권한과 환경 지원이 필요합니다. 화자 자동 분리는 지원하지 않으며, AI 회의록은 검토가 필요한 초안입니다. 먼저 짧은 녹음으로 확인하세요.

## v0.1.1 변경사항

녹음 중 구간 전사, 완료 구간 재사용, 미완료 구간 이어받기와 취소를 추가했습니다. [릴리즈 설명](https://github.com/damon80q/obsidian-meeting-notes-online-ai-release/releases/tag/v0.1.1) · [변경 기록](CHANGELOG.md)

## 참고

- [모델·환경 설정](docs/CONFIGURATION.md)
- [오류 해결](docs/TROUBLESHOOTING.md)
- [검증 범위](docs/STATUS.md)
- [배포판 업데이트 절차](docs/RELEASE_PROCESS.md)

<details>
<summary>개발용 검사·빌드</summary>

```sh
npm ci
npm run typecheck
npm test
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
npm run build
npm run package
```

Python 검사는 `server/requirements.txt`의 의존성이 준비된 가상환경에서 실행합니다. 실제 `.env`·`data.json`·인증정보·개인 원음·운영 로그는 배포 코드에 넣지 않습니다.

</details>
