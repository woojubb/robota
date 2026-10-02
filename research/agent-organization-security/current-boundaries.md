# 현재 실행 경계

## 확인한 코드 흐름

| 경로                        | 권한·격리 적용 지점                                                                                                                                                | 해석과 남은 확인                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 공통 startup            | `packages/agent-cli/src/cli-core.ts`: settings → `createProductSandbox` → startup 문제 검사 → pack/session 구성                                                    | TUI·print·serve의 공통 구성. `sandbox.failIfUnavailable`이 true인 경우에만 startup 실패가 fatal이다. 모드별 실제 전체 프로세스 검증은 아직 필요하다.             |
| print/headless              | `packages/agent-cli/src/modes/print-mode.ts`: HeadlessInteractionChannel, default permission mode, sandbox 전달                                                    | 승인자가 없는 ask는 거부한다. 임의 명령 승인 여부와 명령 실행 격리는 서로 다른 단계다. `shellExec` 같은 별도 경로도 정책 대상이어야 한다.                        |
| serve                       | `packages/agent-cli/src/modes/serve-mode.ts`: `buildServeSessionOptions`가 sandbox를 session으로 전달                                                              | 전달 검사만으로 원격 인증이나 hosted 경계를 증명하지 않는다.                                                                                                     |
| Shell/Bash                  | `packages/agent-tools/src/builtins/shell-tool.ts`: separate client는 `run`, shared client는 `wrapCommand`, 없으면 host spawn                                       | 실행 중 backend 오류는 host 재시도로 바뀌지 않는다. disabled/unavailable/excluded는 처음부터 unconfined invocation이 될 수 있다.                                 |
| Read/Write/Edit             | `packages/agent-tool-defaults/src/create-default-tools.ts`: shared면 host root guard, separate면 client 파일 API                                                   | raw tool factory에 shared client를 직접 넣는 것과 product의 default-tools composition을 혼동하지 않는다.                                                         |
| Glob/Grep 및 host 전용 도구 | 동일 default-tools 구성의 separate filesystem 분기                                                                                                                 | separate에서는 일부 host 전용 도구가 빠진다. 원격 작업의 기능 범위는 local과 같다고 주장할 수 없다.                                                              |
| sandbox 자동 승인           | `packages/agent-framework/src/assembly/sandbox-approval.ts`: Shell/Bash만 sandbox 자동 승인 조회                                                                   | deny·ask 규칙이 먼저 적용된다. sandbox가 승인하지 않는 background/model slash command도 별도 실행 경로로 조사한다.                                               |
| child-process subagent      | `packages/agent-cli/src/product/subagent-composition.ts`, `packages/agent-subagent-runner/src/worker-composition.ts`                                               | type+snapshot와 factory가 필요하며 복원 불가능한 투영은 거부한다. OS sandbox는 child의 root에서 별도 구성하고 live settings를 전달한다.                          |
| E2B adapter                 | `packages/agent-tools/src/sandbox/e2b-sandbox-client.ts`                                                                                                           | shell/file API와 snapshot/pause/connect를 중개한다. 계정 신원·회사 승인·송신 정책은 이 adapter가 강제하지 않는다. 실제 서비스 수명과 SDK 호환성 검증이 필요하다. |
| Electron UI/daemon          | `apps/agent-app/electron/sidecar.ts`, `packages/agent-cli/src/session-inventory/daemon-command.ts`, `packages/agent-transport-ws/src/ws-transport-configurable.ts` | sidecar는 loopback+token URL만 받아 renderer CSP를 해당 port로 제한한다. WS는 loopback bind, token 및 Host/Origin guard를 강제한다. remote UI는 별도 계약이다.   |

## 모드별 추가 경계

MCP stdio는 부모 process의 입출력 소유권을 신뢰하고 `runMcpServeMode`가 session을 공통
startup options로 만든다. local HTTP는 새 0600 token file과 loopback carrier를 사용하며 종료 때
본인이 만든 inode만 제거한다. remote HTTP 경로는 별도 issuer/resource/scopes/subjects 검증과
trusted proxy 계약을 사용한다. local daemon token을 remote bearer로 재사용하지 않는다.
이 소스 대조 자체는 실제 issuer/JWK outage 및 원격 UI 실행 증거가 아니다. 아래 별도
HTTPS 실험은 로컬 합성 issuer와 실제 CLI remote gate만 검증한다.

`startup/shell-exec.ts`의 command expansion은 execSync와 hostEnvironment를 직접 사용하며
OsSandboxClient를 받지 않는다. `agent-executor`의 managed shell background runner도 별도
spawn 경로다. sandbox auto-approval은 이 도구들을 승인하지 않지만, 다른 정책으로 허용한 뒤의
filesystem/env/network 경계를 OS Shell 도구와 같다고 간주하면 안 된다. hooks·MCP stdio process·
HTTP/WebFetch 같은 네트워크 실행도 hosted worker/broker 설계의 별도 강제 지점으로 다룬다.
TUI는 공통 runtime session과 shellExec를 사용하고 Electron renderer는 그 실행 경계가 아니다.

## 실제 Linux 관측

`poc/current-boundaries.mts`는 production `OsSandboxClient`, default-tools composition,
worker restoration을 실제로 호출한다. 현재 결과는 16개 관측이 일치한다.

| 관측                              | 결과                                         | hosted 설계에 주는 제약                                                                                                        |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| default disabled                  | 승인됐다고 가정한 명령이 host에서 실행됨     | hosted의 필수 격리를 local 기본 설정에 맡길 수 없다.                                                                           |
| active shell의 runtime file 읽기  | workspace 밖의 합성 runtime canary 읽기 성공 | read-only host mount는 confidentiality 경계가 아니다.                                                                          |
| active shell의 runtime env 읽기   | 합성 환경 변수 상속 확인                     | 모델·회사 API 키를 runtime env에 두고 shell을 같은 환경에서 spawn하면 키 경계가 없다.                                          |
| workspace 쓰기                    | 성공                                         | 작업별 파일 쓰기는 필요하지만 작업 root와 shared asset을 나눠야 한다.                                                          |
| 기존 `.git/config` 쓰기           | 거부                                         | git commit 같은 정상 작업도 현재 OS sandbox와 충돌할 수 있다. 원격 작업 VM에서는 작업 소유 `.git`만 별도 정책으로 다뤄야 한다. |
| workspace와 temp 밖 쓰기          | 거부                                         | host integrity 제한은 실제로 작동한다. 전체 host confidentiality를 뜻하지 않는다.                                              |
| 다른 합성 작업의 `/tmp` 파일 쓰기 | 성공                                         | 공유 temp를 허용하는 같은 host sandbox는 작업 간 격리로 충분하지 않다.                                                         |
| 명시적 denyRead 파일              | 값 노출 차단                                 | blacklisting이 완전한 secret boundary를 보장하지 않는다. env 상속도 별개다.                                                    |
| backend 미지원/부재               | client만 호출하면 unconfined 실행            | product startup에서 필수 capability 오류를 강제해야 한다.                                                                      |
| excluded program                  | unconfined 실행                              | hosted에서는 exclusions를 허용하지 않거나 별도 승인된 broker operation으로 표현한다.                                           |
| backend 실행 실패                 | non-zero, host 재시도 없음                   | 기존의 fail-closed 성질을 hosted에서도 유지한다.                                                                               |
| network disabled                  | host loopback 서비스 접근 거부               | 별도 net namespace + Unix-socket seccomp가 강제 지점이다. DNS/domain allowlist나 원격 provider 정책 검증은 별도다.             |
| product-composed Read             | outside root 거부                            | 파일 도구 경로 가드와 shell 전체 filesystem 정책은 다른 경계다.                                                                |
| worker restore unknown type       | 오류                                         | 복원 실패를 빈 sandbox나 host 실행으로 바꾸지 않는 기존 동작을 유지한다.                                                       |

이 실험은 사람의 승인 우회나 prompt injection 성공을 재현한 것이 아니다. admitted shell의
후속 권한 범위를 측정했다. 실제 계정·호스트 비밀정보를 읽거나 공격하지 않았다.
Linux 결과로 Seatbelt나 Windows 동작을 증명하지 않는다. macOS backend와 미지원 플랫폼은
소스 및 기존 테스트와 대조한 뒤 실제 환경 관측의 부재를 표시한다.

## 실제 KVM guest의 CLI와 daemon

Ubuntu 24.04 cloud image를 공식 SHA256과 대조한 뒤 host filesystem mount와 outbound network
없이 KVM guest를 시작했다. Node 22.22.0과 `pnpm --prod deploy`의 실제 CLI dependencies를
SSH로 전달했다. 생략한 외부 dependency와 개발 전용 replay/provider 설정으로 실패한 최초
시도도 `evidence/vm-initial.json`에 남겼다. 정상 실행은 guest loopback의 합성 chat-completions
provider를 사용하며 모델 API에 실제 key나 비용을 쓰지 않는다.

`poc/vm-smoke.py`는 실제 headless 결과, default 모드에서 approver 없는 shell의 파일 미생성,
`--allowed-tools Bash`를 명시한 경우의 파일 생성을 각각 CLI exit code와 별도 filesystem
관측으로 확인한다. 모델의 "완료" 텍스트는 tool 실행 증거로 사용하지 않는다.
[결과](evidence/vm-smoke-linux.json).

실제 `daemon start --json`을 두 번 실행해 같은 daemon의 재사용을 확인했다. guest에서 잘못된
token·누락 token·untrusted Host/Origin은 session data를 받지 못했고 올바른 token은 받았다.
그 후 실제 `daemon stop` 및 `status`에서 running=false를 확인했다. token-bearing URL과 session
payload는 보고서에 저장하지 않았다. [인증 결과](evidence/vm-daemon-auth-linux.json).

이 첫 guest는 runtime과 shell이 같은 VM이므로 runtime/job 분리 증거로 사용하지 않는다.
별도 worker와 연구 broker 관측은 아래에 따로 기록하며 production 통합과 provider 동작은 아직 검증이 필요하다.

## 제안하는 hosted 실패 처리

필수 sandbox는 startup뿐 아니라 매 실행과 재개 때 다시 확인한다. 없는 client, unknown
factory, 실패한 attestation, 유효하지 않은 snapshot, 정책 epoch 불일치, expired delegation,
egress proxy 부재는 작업 admission을 거부한다. 호스트 fallback, 빈 filesystem으로 교체,
전역 권한 확대는 하지 않는다. 오류는 어떤 capability가 필요한지 명시하고 회사 운영자가
구성하도록 한다. local 개인 모드의 opt-out과 hosted 조직 모드의 필수 격리를 구분한다.

## 별도 task worker와 병렬 정책

QMP/실제 process argv/drive 목록에서 두 worker의 KVM 활성화와 독립 overlay를 확인했고,
host positive-control HTTP 서비스가 정상일 때 guest의 host gateway·metadata 주소·공개 IP에
대한 직접 TCP 연결 세 개는 실패했다. 이 결과는 provider DNS/redirect policy를 증명하지 않는다.
[실제 VM manifest](evidence/vm-configuration-linux.json), [재현 recipe](poc/vm-recipe.md).

실제 CLI의 Read/Write/Git은 worker에서 정상 동작했다. 최초 subagent 실험은 SDK의 Agent tool
이름을 CLI에 요청해 실패했다. CLI의 실제 모델 호출 경로는 product prefix가 붙은 /agent command
projection이며 별도 재실행 결과와 초기 실패를 모두 보존한다. 모델의 완료 문장은 성공 판정에
쓰지 않는다. [최초 결과](evidence/vm-worker-tools-initial-linux.json),
[수정한 경로의 결과](evidence/vm-worker-tools-corrected-linux.json).

[병렬 조직 실험](parallel-results.md)은 합성 신원·부모 예산·승인·CAS·중복 외부 효과·실제 crash와
회수를 별도 broker로 검증한다. 이 prototype을 생산 CLI의 보안 기능으로 표시하지 않는다.

실제 MCP stdio의 initialize/catalog/submit, protocol-only stdout과 정상 signal 종료 5개를
확인했다. [MCP 결과](evidence/vm-mcp-linux.json). 실제 VM의 filesystem 분리, pause/resume,
offline disk restore에서 descendant 미재개와 종료 4개도 관측했다.
[VM lifecycle](evidence/vm-lifecycle-linux.json). 첫 20초 shutdown 대기 초과는 실패 결과로 남겼고
60초 bounded retry에서 정상 종료를 확인했다. 이후 [확장 실험](evidence/parallel-recovery-linux.json)은
local reference topology의 identity 회수·VM/tunnel/child 종료·disk restore·옛 identity 거부·새 key와
현재 journal 재사용을 연결했다. production/cloud revoke→restore 흐름의 증거는 아니다.

리뷰에서 초기 Read/Git 판정이 누적 로그와 과거 HEAD로 통과할 수 있음을 발견했다. 해당
[역사적 판정](evidence/vm-worker-tools-stale-evidence-linux.json)은 완료 증거에서 제외한다.
수정한 probe는 run별 UUID와 새 repository, 해당 UUID의 Read response, 유일한 새 Git commit과
정확한 commit 파일 내용을 확인한다. 같은 guest에서 두 번 재실행한 결과를 각각 보존한다.
[최신 결과](evidence/vm-worker-tools-corrected-linux.json), [반복 결과](evidence/vm-worker-tools-repeat-linux.json).

Read 및 Git 실행을 각각 명시적으로 금지한 negative control에서도 최신 file predicate는 실패했다.
이 실패를 예상한 control 판정이 통과한 것이며 파일 작업 성공으로 세지 않는다.
[Read 거부](evidence/vm-worker-files-deny-read-linux.json), [Git 거부](evidence/vm-worker-files-deny-git-linux.json).

## 실제 CLI remote MCP와 임시 HTTPS issuer

[14개 관측](evidence/remote-mcp-https-linux.json)은 실제 CLI의 remote MCP carrier와 실제
HTTPS metadata/JWKS 서버, 합성 Ed25519 JWT를 사용한다. 유효한 token은 MCP initialize의
protocol response를 받았다. token 부재, 잘못된 audience·scope·subject·signature·expiry와
Host header는 세션 admission 전에 401/403으로 거부됐다. CLI stdout은 비어 있고 diagnostics에
실험 token이 없었다. 기존 회사 key를 읽거나 외부 issuer에 접속하지 않았다.

Issuer 장애는 즉시 모든 token을 거부하는 정책이 아니다. 실제 CLI의 아직 젊은 key cache는
유효한 token을 계속 받는다. 별도 생산 verifier에서 cold cache는 keys-unavailable이며, 같은
실제 HTTPS 서버와 monotonic clock dependency만 가속한 hard-age 관측도 keys-unavailable이었다.
후자는 실제 한 시간 경과나 CLI clock 변경의 증거가 아니다. metadata redirect는 목적지의
실제 request count 0으로 미추종을 확인했다.

공개 resource URL은 합성 Host header로 표현한 loopback HTTP listener다. 공개 TLS ingress,
trusted proxy·Electron remote pairing·provider egress를 검증했다고 해석하지 않는다. TLS CA는
그 실험 child의 NODE_EXTRA_CA_CERTS에만 지정하고 인증 key/설정/HOME을 임시 디렉터리에 둔다.
실험 CLI와 HTTPS 서버 종료 후 디렉터리를 지운다. [재현 프로그램](poc/remote-mcp.mts):

```sh
pnpm exec tsx research/agent-organization-security/poc/remote-mcp.mts /tmp/remote-mcp.json
```

Linux/macOS, OpenSSL, 빌드된 CLI와 저장소 의존성이 필요하다. cold/stale issuer 장애를 관측한
verifier는 생산 함수지만 CLI process와 다른 cache다. 네트워크 정책의 source도 대조했으며,
`agent-core/src/utils/egress-policy.ts`의 resolve-then-validate는 connect-time 주소를 고정하지
않아 DNS rebinding 창이 남는다. hosted egress 강제 지점의 provider 실측에서 이 위험을 별도로
검증해야 한다.

## 실제 terminal TUI

[PTY 7개 관측](evidence/tui-pty-linux.json)은 기존 terminal test driver와 빌드된 실제 CLI를
임시 HOME/state에서 실행한다. prompt·Idle 렌더링, `/help`의 입력 이후 command 결과와 model
request 0, 별도 고유 user prompt를 받은 loopback model의 응답 렌더링과 request 1을 확인했다.
응답 marker는 입력에 없는 값이므로 prompt echo를 모델 실행 증거로 세지 않는다. `/exit`의
실제 확인 UI에 응답한 뒤 process exit 0, server 종료 및 임시 state 삭제를 확인했다.

처음에는 Vitest 전용 convenience wrapper의 `__dirname` 때문에 실험 entry point를 실행하지
못했다. [setup 실패](evidence/tui-initial-linux.json). 다음 수동 provider profile의 잘못된
`baseUrl` 필드는 적용되지 않아 공급자 기본 API가 합성 키 요청을 401로 거부했고 local model
request는 0이었다. [초기 모델 실패](evidence/tui-model-initial-linux.json). 정상 재현은 실제 CLI
`--configure-provider`로 설정하고 저장된 `baseURL`이 자기 loopback server인지를 먼저 검사한다.
리뷰에서 request counter가 고유 prompt를 통과한 요청만 세어 잘못된 추가 요청을 놓칠 수
있음을 재현했다. [수정 전 counter 실패](evidence/tui-counter-initial-linux.json)는 실제 `/help`
HTTP 주입을 400으로 거부해도 카운터가 0이고 요청 부재 판정이 true임을 보존한다. 수정한
probe는 callback 진입부터 모든 HTTP 요청을 세고 matching prompt 요청을 별도로 센다. 같은
주입은 요청 부재 판정을 false로 만든다. 모델 turn의 요청 1은 주입 이후 증가량이다.
제품이나 기존 PTY harness를 수정하지 않았다.

이 결과는 Linux terminal의 plain-text turn과 user slash command 관측이다. TUI에서 실행한
악성 tool code, hosted worker 격리, Electron 또는 macOS UI의 증거가 아니다.
[재현 프로그램](poc/tui-pty.mts)은 Node 22, 빌드된 CLI와 저장소의 기존 PTY 의존성이 필요하다.

```sh
pnpm exec tsx research/agent-organization-security/poc/tui-pty.mts /tmp/tui-pty.json
```
