#!/usr/bin/env bash
# 회의록 앱을 에이전트의 프록시 환경과 분리된 systemd 사용자 런타임에서 실행합니다.
# 기존 영구 systemd 서비스가 없는 별도 시험 환경용입니다. 운영 설치는 SETUP을 따릅니다.
# 이 명령은 부팅 자동실행을 등록하지 않으며 기존 서비스·모델·인증정보를 바꾸지 않습니다.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_dir=$(cd -- "$script_dir/.." && pwd)
if systemctl --quiet is-active ai-meeting-notes-online.service || systemctl --user --quiet is-active ai-meeting-notes-online.service; then
  printf '%s\n' '영구 정리 서비스가 이미 실행 중입니다. systemctl status ai-meeting-notes-online.service로 확인하세요.'
  exit 0
fi
runtime_unit=ai-meeting-notes-online-runtime.service
if systemctl --user --quiet is-active "$runtime_unit"; then
  printf '%s\n' '정리 서버가 이미 실행 중입니다. 중복 실행하지 않습니다.'
  exit 0
fi
if [[ ! -f "$project_dir/.env" ]]; then
  printf '%s\n' '프로젝트 .env를 먼저 준비하세요. 예제로 기존 인증을 덮어쓰지 마세요.' >&2
  exit 1
fi
if [[ -n "${MEETING_NOTES_NODE_BIN:-}" ]]; then
  node_bin=$MEETING_NOTES_NODE_BIN
elif [[ -x "$project_dir/runtime/node" ]]; then
  node_bin="$project_dir/runtime/node"
else
  node_bin=$(command -v node)
fi
# PATH만 명시적으로 전달합니다. 호출 에이전트의 HTTP_PROXY·NODE_USE_ENV_PROXY는 전달하지 않습니다.
systemd-run --user --collect --unit=ai-meeting-notes-online-runtime \
  --property=Restart=on-failure --property=RestartSec=3s \
  --working-directory="$project_dir" --setenv="PATH=$PATH" \
  "$node_bin" --env-file=.env server/index.mjs
printf '%s\n' '상태 확인: systemctl --user status ai-meeting-notes-online-runtime.service'
