# 병렬 조직 정책과 작업 VM 실측

이 실험은 생산 조직 control plane 구현이 아니다. 두 실제 KVM worker가 각자의 합성
Ed25519 actor key로 서명하고 SSH reverse tunnel의 단일 loopback broker endpoint를 호출한다.
Broker와 외부 effect surrogate는 다른 host process와 SQLite DB를 사용한다. issuer private key,
upstream credential, 위임·예산·승인 journal은 guest에 복사하지 않는다. worker는 자기 제한된
credential만 받는다. workload attestation, KMS, OPA, tenant 전체 budget은 구현하지 않았다.

## 강제 지점과 관측

| 계약           | 실제 강제 지점                                                                       | 관측과 한계                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 신원·위임      | issuer signature, actor proof, scope/TTL, 모든 ancestor의 현재 DB record와 회수 검사 | cross-task, 다른 actor key, invalid signature, expired identity 거부. host controller가 신원을 provision하며 실제 workload attestation은 아님.                         |
| 부모 예산 합산 | SQLite BEGIN IMMEDIATE에서 모든 ancestor 사용량 검사·예약                            | 두 자녀가 60씩 동시에 요청하면 부모 100 중 60만 사용하고 하나는 429. 외부 결과 unknown 예약은 유지. 이 ledger는 합성 금액만 다룸.                                      |
| 고영향 승인    | 별도 issuer-signed approval의 actor/task/epoch/digest/TTL와 unique approval ID       | 승인 누락, 인자 변경, 아직 사용되지 않은 operation의 잘못된 승인 actor를 거부. raw agent message는 승인 경로가 아님.                                                   |
| 중복·장애      | durable operation reservation + 별도 서비스의 idempotency key                        | 동시 요청은 같은 receipt와 한 external transaction. 실제 broker exit 72를 external effect 후/local ack 전에 발생시킨 뒤 재시도해 transaction과 budget가 중복되지 않음. |
| 공유 상태      | task-bound CAS revision과 fence                                                      | 두 writer 중 하나만 revision을 갱신. 최신 revision이어도 옛 fence는 거부. Git merge/CAS lease 자동 복구 전체 구현은 아님.                                              |
| 회수           | request마다 leaf/ancestor record 검사                                                | 저장된 옛 credential과 완료 operation 재요청도 회수 후 거부. root 회수는 descendants의 신규 admission을 막음. 이것만으로 VM/process/network 종료를 증명하지 않음.      |
| 감사           | credential·body 제외 metadata hash chain, controller가 보유한 anchor                 | 실제 state value의 합성 canary와 upstream key 미노출. 변조·삭제·역순을 anchor와 대조해 탐지. 독립 remote audit service와 controller 자체 침해는 미검증.                |

[실측 결과](evidence/parallel-organization-linux.json),
[broker 및 외부 surrogate](poc/organization-broker.py), [실험 driver](poc/parallel-experiment.py),
[guest client](poc/guest-broker-client.mjs).

## 서명 표현 계약

Python과 Node는 UTF-8 canonical JSON을 공유한다. schema key는 ASCII이며 lexicographic 순서로
직렬화한다. 값은 Unicode scalar 문자열, boolean, null, array/object와 JS safe integer만 허용한다.
fraction, overflow, unpaired surrogate, non-ASCII schema key를 거부한다. 표시명·업무 문자열의
한글과 이모지는 허용한다. 숫자 모양의 ASCII key도 JSON.stringify의 property ordering에
의존하지 않고 직접 정렬한다. 이는 제한된 연구 schema 계약이며 범용 JCS 표준 구현이라고
주장하지 않는다. [실제 두 함수의 교차 언어 서명 검증 10개](evidence/canonical-signing-linux.json).

초기 actor-binding 실험은 기존 operation의 idempotency-conflict에서 먼저 거부돼 승인 actor
guard의 증거가 아니었다. 수정한 실험은 unused operation에 actor-a approval과 actor-b proof를
보내 403/approval-binding 및 external effect 0을 확인한다. 초기 Unicode 표현 불일치도 리뷰에서
재현됐고 실제 Python/Node 함수의 공통 byte 계약과 교차 언어 regression으로 수정했다.

## 재현과 보존

먼저 [KVM recipe](poc/vm-recipe.md)로 worker-a/b의 port 22243/22244를 준비한다. controller에는
Python 3.11 이상과 cryptography가 필요하고 guest에는 Node 22와 SSH만 필요하다. 기존 회사 credential을
사용하지 않는다. driver는 ephemeral signing keys와 DB를 별도 임시 directory에 만들고 자기
request 파일, broker/effect process와 SSH tunnel을 finally에서 정리한다. 기본 모드의 VM은
별도 lifecycle 실험에서 정리하고, recovery 모드는 자신이 다시 띄운 VM도 종료한다.
stdout·보고서에 credential/private key/request body를 넣지 않는다.

```sh
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/parallel-experiment.py \
  --vm-dir "$TASK_VM_DIR" --output "$TASK_VM_DIR/parallel-results.json"
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/check-canonical.py \
  --node "$(command -v node)" --output "$TASK_VM_DIR/canonical-results.json"
```

Guest로 허용한 reverse forward는 broker의 /apply뿐이고 issuer/admin endpoint는 제공하지 않는다.
Provider management API, 실제 회사 결제/배포 API, DNS/raw-IP 정책 gateway는 연결하지 않았다.
결과 unknown인 외부 API가 idempotency를 지원하지 않을 때는 이 방식으로 자동 재시도할 수 없으며
별도 reconciliation owner가 필요하다. cloud invoice, 장시간 reliability, process/token/time budget,
production CLI의 task-bound worker API 연결과 cloud provider의 통합 restore/revoke 경로는
남은 검증이다. 아래 확장 실험은 local reference topology의 통합 경로를 검증한다.

실측 controller는 Python 3.14.4, cryptography 46.0.5였다. 잘못된 canonical domain을 포함한
HTTP request 3개도 privileged effect 없이 거부하고 안전한 metadata audit을 남겼다.
[거부/감사 결과](evidence/broker-invalid-domain-linux.json), [재현](poc/probe-invalid-domain.py).

## 실제 회수·디스크 복원과 외부 결과 unknown 보강

[확장 실측](evidence/parallel-recovery-linux.json)은 같은 두 guest/control journal에서 24개
observation record를 확인한다. `--with-vm-recovery`는 정상 승인된 actor job과 private actor
credential을 자기 worker disk에 저장한 뒤, offline checkpoint를 만든다. 실행 중인 worker의
신원을 회수하고 실제 child process·열린 broker TCP 연결의 SSH tunnel·VM을 중단한다.
Checkpoint digest를 검증하고 디스크를 복원해 옛 identity file이 실제로 돌아왔음을 확인해도
요청은 403/revoked-or-epoch였다. 새 signing key/leaf epoch와 scope로 복구한 요청은 성공했고
snapshot 밖 부모 ledger는 이미 쓴 80에 새 1을 더한 81이었다. 이것은 local reference topology의
통합 회수/복구 실험이며 production CLI/cloud/tenant-wide emergency stop 검증은 아니다.
`revoked-saved-identity` record는 같은 복원 후 거부 응답을 다시 제시하므로 24개 record를
24개의 독립 요청이나 공격으로 세지 않는다. 열린 연결은 guest TCP 연결 준비와 해당 SSH
tunnel 종료로 관측했으며 provider 전체 connection inventory를 조회한 결과는 아니다.

별도 surrogate를 idempotency가 없는 모드로 실행해 effect 후 응답 유실을 발생시켰다. Broker는
pending 예약과 한 외부 transaction을 보존하고 재요청을 503/external-reconciliation-required로
거부했다. trusted asset owner가 worker 밖에서 외부 receipt·digest를 확인해 journal을 정산한
뒤에는 같은 결과를 돌려주되 외부 effect를 다시 발생시키지 않았다. 이 owner 경로는 연구
controller의 직접 DB reconciliation이며 생산 approval UI나 운영 API 구현은 후속 이슈다.

[Guard negative control](evidence/unknown-guard-regression-linux.json)은 같은 signed HTTP 요청과
비-idempotent surrogate에서 retry 거부 분기만 임시 메모리 모듈에서 제거했다. 현재 코드에서는
503과 external effect 1개였고, 해당 guard가 없으면 retry 200과 effect 2개였다. 이 관측은 응답
유실 후 자동 재시도가 실제로 중복 효과를 만드는 조건을 확인하며 저장소 원본을 바꾸지 않는다.

리뷰는 복원 VM의 graceful 종료가 timeout이면 뒤의 tunnel/control service 정리도 건너뛰는
오류를 재현했다. 수정한 driver는 자원별 독립 정리를 시도하고 자기 process의 terminate/kill
fallback 후 오류를 보고한다. [실제 임시 process 회귀](evidence/cleanup-faults-linux.json)는 저장된
수정 전 cleanup AST에서 SSH timeout 후 네 process가 살아 있음을 확인하고, 현재 cleanup의
SSH timeout·worker wait timeout에서는 네 process가 모두 종료되고 오류가 보고됨을 확인한다.
이는 실제 QEMU outage나 provider cleanup 실패의 실측을 대신하지 않는다.
수정한 driver로 [전체 두 guest 실험을 재실행](evidence/parallel-recovery-repeat-linux.json)해
24개 record와 정상 process/tunnel 정리를 다시 확인했다. 초기 확장 결과도 함께 보존한다.

```sh
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/parallel-experiment.py --with-vm-recovery \
  --vm-dir "$TASK_VM_DIR" --output "$TASK_VM_DIR/parallel-recovery.json"
python3 research/agent-organization-security/poc/git-conflict.py \
  --output "$TASK_VM_DIR/git-conflict.json"
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/check-unknown-guard.py \
  --output "$TASK_VM_DIR/unknown-guard-regression.json"
PYTHONPYCACHEPREFIX=/tmp/issue-2-research-pycache python3 \
  research/agent-organization-security/poc/check-cleanup.py \
  --output "$TASK_VM_DIR/cleanup-faults.json"
```

[실제 Git 실험](evidence/git-conflict-linux.json)은 두 task 후보의 동일 baseline ref 경합,
경합 후 stale baseline 재시도, 같은 파일의 content conflict 및 merge abort 뒤 candidate/accepted
ref 보존 4개를 확인한다. local synthetic repo만 사용하며 회사 Git broker의 신원·branch·lease
권한이 이미 구현됐다는 뜻이 아니다.
