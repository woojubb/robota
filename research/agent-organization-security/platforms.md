# 플랫폼 후보 비교

공식 문서 확인일: 2026-09-30. 아래 수명·가격은 출처의 현재 설명이며 실제 계정에서의
지원 여부, 지역별 가격, 지연, 과금은 PoC로 확인해야 한다. 출처에 없는 보장을 추정하지 않는다.

| 후보와 목적 | 확인한 성질 | 경계·운영 책임 | 아직 필요한 실측 |
| --- | --- | --- | --- |
| Fly Machines: 장시간 headless runtime | VM contents와 application network security는 고객 책임. Machines API가 VM lifecycle을 제공 | runtime 안의 shell과 runtime key는 자동 분리되지 않는다. 앱 image, auth, 권한과 서비스는 운영자가 보호 | 실제 CLI/daemon·WS 재연결, stop/start/suspend, volume state, cleanup, 지역별 사용량 |
| Fly Sprites: task worker | persistent filesystem, checkpoint와 exec/TTY/service API. 현재 lifecycle 문서는 sleep 후 RAM/process가 유지되지 않는다고 설명 | task마다 별도 Sprite와 scoped management 권한 필요. disk restore를 paused instruction 재개로 취급하지 않음 | node/shell/Git/child 실행, process 종료/재시작, 파일 checkpoint, network policy/raw-IP/Unix socket 우회, 실제 계정 region |
| E2B: task worker 및 기존 SDK adapter 대조 | 공급자는 session별 microVM 격리를 설명. 현재 Hobby는 최대 1h session/20 concurrency, Pro는 최대 24h와 별도 usage | 실제 E2B SDK와 기존 adapter의 pause/snapshot/connect 계약을 확인. 회사 승인·위임은 별도 broker | exact SDK version, pause result·resume identity, 네트워크 deny, snapshot 후 revoke, timeout/kill/cleanup |
| Lambda 일반 function: 짧은 요청/trigger | 일반 invocation 최대 900s, image root read-only와 writable `/tmp`; execution environment 재사용 | worker 명령과 function role credential이 같은 environment면 업무 권한 경계가 아니다. 상태를 local RAM/tmp 지속성에 의존하지 않음 | Node/child/Git packaging, cold/warm invocation, timeout 후 child/파일 상태, IAM/metadata 접근, 실제 요청 비용 |
| Lambda Managed Instances / MicroVMs: 추가 평가 후보 | 같은 현재 quotas 문서가 Managed Instances의 일부 async invocation 90min, ARM64 MicroVM 최대 8h 및 suspend/resume API를 구분 | 일반 function의 15min 결론을 전체 Lambda 제품군에 일반화하지 않음. 계정·region 지원과 별도 권한/비용 확인 필요 | 새 API 접근 가능성, ARM64 CLI artifact, lifecycle/WS/state 및 실제 과금 |

위 표의 세부 기능은 다음 공식 자료에 근거한다. 공급자 기본 격리는 회사 업무 최소 권한,
승인 일회성, agent 간 신뢰성의 증거가 아니다.

- [Fly shared responsibility](https://fly.io/docs/security/shared-responsibility/): virtualization boundary와 고객의 image·application·authentication 책임.
- [Machines API](https://fly.io/docs/machines/api/machines-resource/): 실행·중단·재개 등 실제 lifecycle schema.
- [현재 Sprites lifecycle](https://docs.fly.io/sprites/working-with-sprites/): filesystem 지속, RAM 손실, service restart와 exec/TTY session.
- [Sprites checkpoint 설명](https://fly.io/sprites/): disk checkpoint, process instruction의 재개와 구분.
- [Sprites network policy API](https://sprites.dev/api/sprites/policies): DNS filtering과 즉시 적용이라는 문서상 성질. raw IP·자체 resolver·기존 연결은 실제 공격 실험 전까지 보장 미판정.
- [E2B security](https://e2b.dev/security), [현재 제품 경계](https://e2b.dev/), [공식 SDK 문서](https://docs.e2b.dev/).
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html): 일반 function·Managed Instances·MicroVM 제한을 각각 확인.
- [Lambda environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html), [container filesystem](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html).

## 상태 복구와 지연의 판정

Sprite sleep/restore는 process continuity를 뜻하지 않는다. 오래된 검색 결과의 문구와 현재
문서가 다르면 현재 lifecycle/API를 기준으로 가설을 작성하고 실측으로 판정한다. suspend,
pause, checkpoint, filesystem restore는 provider별로 동일한 의미가 아니다. `ready` 응답부터
실제 shell·CLI 첫 결과까지를 측정하고, 최초 provisioning·cold boot·warm wake·restore를
별도로 최소 3회 기록한다. local VM 측정값을 cloud cold-start 값으로 옮겨 쓰지 않는다.

WS/세션은 runtime server가 실제 carrier 인증·토큰 만료·reconnect·session binding을 수행하는지
확인한다. Lambda trigger와 별도 WebSocket gateway를 합친 topology는 gateway 비용·state·auth를
추가해야 하며 일반 function이 데스크톱 loopback daemon을 그대로 host할 수 있다고 쓰지 않는다.

## 비용 측정 계획

현재 [Fly pricing](https://fly.io/pricing/)은 Machine compute를 실행 시간, volume을 provisioned
capacity, egress를 region별 GB에 과금한다. Sprites는 CPU $0.07/CPU-hour, 실제 memory
$0.04375/GB-hour, hot storage $0.000683/GB-hour, retained cold storage $0.000027/GB-hour를
표시한다. 실제 API usage와 invoice의 region·단위를 저장한다. sleep/stop이 모든 저장 비용의
종료라는 가정을 하지 않는다. 서로 다른 Fly pricing 페이지의 선택 region/default preset 가격을
섞지 않는다.

[E2B pricing](https://e2b.dev/pricing)은 Hobby credits와 usage, Pro $150/month+usage를 구분한다.
PoC를 위해 Pro 가입이 필요하면 신규 구독을 자동으로 구매하지 않고 별도로 결정한다. 무료
credit도 실제 사용량 기록을 대체하지 않는다. AWS 함수·MicroVM·logging·storage·gateway의
가격은 실제 실험 region과 서비스 종류를 정한 뒤 공식 가격표로 산출한다.

측정 record는 provider, region, resource ID, image/SDK version, started/stopped/deleted 시각,
CPU/RAM/storage/egress/request/log usage, 당시 rate, currency, 계산식, invoice lag,
cleanup 검증을 포함한다. 모델 API 사용은 합성 provider로 대체하고 제품 inference 비용과
platform execution 비용을 분리한다. 실제 비용 데이터가 없으면 estimated/unmeasured로 표시한다.
