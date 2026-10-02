# 검토 가능한 클라우드 PoC 실험안

상태: 실행 승인과 임시 계정 구성이 필요하다. 현재 실제 cloud resource를 만들거나 계정 토큰을
읽지 않았다. 아래 실험용 자원만 만들고 정리하는 계획이며 회사 production 자산은 사용하지 않는다.
로컬 KVM 실험은 먼저 수행하고, cloud 결과를 대신하지 않는다.

## 자원과 범위

| 서비스 | 최대 실험 자원 | 시간·데이터 상한 | 목적과 정리 |
| --- | --- | --- | --- |
| Fly Machines | 임시 app 1, runtime Machine 1(2 shared vCPU/2GB), 필요시 1GB volume 1 | 실행 최대 60min, 단일 승인 region, synthetic repo+generated CLI만 | headless/daemon·session·stop/start·volume 복구 확인, 해당 app/VM/volume만 제거하고 재조회 |
| Sprites | synthetic task worker 2, task별 checkpoint 최대 2 | task 실행 각 최대 30min, disk 각 1GB 이하 목표 | cross-task·egress·checkpoint·kill/restore·broker 승인 검증, resource ID별 삭제 및 retained checkpoint 확인 |
| E2B | worker 2, snapshot 최대 2 | Hobby 한도 내 각 30min 이하, SDK/template pin | 기존 adapter의 shell/file/Git/child/pause/connect와 동일 공격 검증, sandbox/snapshot 정리·usage 대조 |
| AWS Lambda | 임시 일반 function 1, 전용 최소 IAM role 1, 제한 log group 1; 지원되면 별도 MicroVM 1 | function invocation timeout 60s, concurrency 1, 호출 최대 30회; MicroVM 30min | 짧은 trigger 기준점·환경 재사용·권한 노출 검증, IAM/function/log/image/snapshot inventory로 잔존 확인 |

신규 유료 subscription, 공개 app URL, 전용 IP, production network 연결, 실제 결제·배포,
실제 repository 쓰기는 포함하지 않는다. 계정 지원 때문에 plan 변경이나 더 넓은 권한이
필요하면 현재 실험을 중단하고 구체적 변경만 따로 결정한다. 예상 incremental usage가 총
US$10을 넘거나 rate를 확인할 수 없으면 다음 자원을 생성하지 않는다. US$10은 아직 승인된
예산이 아니라 제안하는 상한이다. provider billing 지연 때문에 이 local admission 상한을
실시간 invoice hard cap이라고 주장하지 않는다.

## 자격 증명 취급

소유자가 새 임시 조직/계정과 최소 권한 session을 준비한다. 실제 token 값을 chat·문서·issue에
붙이지 않는다. credential 읽기와 resource 생성은 명시적 승인 후 해당 임시 profile만 사용한다.
provider management credential은 control plane에만 두고 VM/worker environment와 snapshot에는
주입하지 않는다. 업무 API는 합성 credential과 외부 side-effect surrogate를 사용한다.

AWS는 기존 production IAM을 변경하지 않는 전용 계정/role이 필요하다. 최소 create/manage/delete
권한을 실험 자원 이름 prefix와 region으로 제한하고, 일반 function execution role은 필요한
log 접근만 갖는다. role 만들기와 pass-role은 권한을 넓히는 행동이므로 소유자의 실행 승인을
받는다. Fly/E2B의 전역 token이 최소 scope로 제한 불가능하면 그 위험을 기록하고 실험 계정을
분리한다. unsupported capabilities는 skip-with-reason으로 기록하고 성공으로 세지 않는다.

## 공통 실험 sequence와 판정

1. pinned artifact·임시 repo·합성 runtime secret·서로 다른 task canary로 runtime과 worker를 구성한다.
2. 실제 headless CLI와 daemon을 실행하고 shell/read/write/Git/child subagent/abort를 수행한다.
3. 두 actor의 신원·scope·TTL·재위임·회수를 검증한다. 각 worker에서 다른 task/runtime/metadata와
   관리자 API에 접근을 시도하고 secret/env/Unix socket/host mount를 탐색한다.
4. DNS·raw-IP·redirect·proxy bypass·기존 connection으로 default-deny egress를 검증한다.
5. 합성 payment/deploy operation의 exact request approval, approval replay·argument tamper·타 actor
   사용을 검증하고 동시 duplicate/retry/crash-after-effect/unknown response를 발생시킨다.
6. shared state CAS·lease fencing·merge conflict를 일으킨다. 예산·task 수·process/time/memory 제한과
   emergency stop 후 모든 descendants/connection/broker admission 거부를 확인한다.
7. checkpoint→회수→restore에서 revoked identity/approval/budget가 부활하지 않는지 확인한다.
   corrupted/missing snapshot과 provider outage에서 host fallback이나 빈 worker 성공을 거부한다.
8. secret canary가 audit에 없는지, event tamper/deletion/order 변경이 독립 anchor로 탐지되는지 확인한다.
9. 각각 start/stop/resume/delete의 지연, resource usage와 비용을 측정하고 resource list로 정리를 입증한다.

각 record는 expected/observed/result와 retry 횟수를 보존한다. 실패한 실험을 지우고 성공한
재실행만 남기지 않는다. mock HTTP provider는 실제 CLI/tool 경로를 작동시키는 용도이며
공격적인 모델 자체의 안전성을 입증하지 않는다. 모든 완료 기준은 completion-audit에서 별도로
확인하고, 실행하지 못한 서비스와 실제 비용 측정이 남으면 전체 연구를 완료 처리하지 않는다.
