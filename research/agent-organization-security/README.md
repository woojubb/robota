# 조직형 에이전트 보안 실행 환경 연구

상태: 조사와 검증 진행 중. 이 문서는 제품 기본값이나 공급자 선택을 확정하지 않는다.
기준 소스는 `2d49741f5aa715edde98d8e5fd2678356226e482`이며 main 승격 커밋과 코드 트리가 같다.

## 판정 원칙과 산출물

런타임 VM의 격리와 모델이 생성한 작업의 격리는 별개다. 회사의 모델 키, 세션,
제어 토큰이 있는 VM에서 임의 명령을 실행하면서 호스트 VM 밖으로만 나가지 못하게 하는
것은 회사 권한을 보호하는 경계가 아니다. 작업별 별도 실행 환경과 외부 정책·자격 증명
중개가 함께 필요하다. 공급자의 설명, 소스에서 확인한 동작, 실제 관측, 제안, 미검증 항목을
각각 구분한다. 공급자의 보안 인증은 애플리케이션 승인 정책의 증거로 쓰지 않는다.

- [현재 코드와 실측 경계](current-boundaries.md)
- [위협 모델·소유권·조직 공통 계약](organization-contract.md)
- [병렬 조직 정책·장애 실측](parallel-results.md)
- [플랫폼 평가와 출처](platforms.md)
- [클라우드 실험안](cloud-experiments.md)
- [현재 Linux 실측 데이터](evidence/current-boundaries-linux.json)
- [재현 프로그램](poc/current-boundaries.mts)
- [완료 기준별 증거와 남은 작업](completion-audit.md)

## 재현

저장소의 pnpm 의존성을 설치한 Linux에서 Node 22, Python 3와 작동하는 bubblewrap이 필요하다.
새 터미널에 회사 키나 실제 클라우드 토큰을 주입하지 않고 실행한다. 임시 HOME과 제품 상태를
사용하며, 아래 프로그램은 무작위 합성 canary만 생성하고 finally에서 실험 파일과 서버를 정리한다.
실행 결과에는 canary 값, 환경 변수 목록, 실제 자격 증명이 저장되지 않는다.

```sh
TASK_RESEARCH_HOME=$(mktemp -d)
env -i PATH="$PATH" HOME="$TASK_RESEARCH_HOME" \
  PRODUCT_USER_STATE_DIR="$TASK_RESEARCH_HOME/product-state" \
  pnpm exec tsx research/agent-organization-security/poc/current-boundaries.mts \
  "$TASK_RESEARCH_HOME/current-boundaries.json"
cat "$TASK_RESEARCH_HOME/current-boundaries.json"
rm -rf "$TASK_RESEARCH_HOME"
```

프로그램은 현재 동작을 확인하는 연구 실험이다. 안전하다는 전체 판정이나 모델 프롬프트
공격 성공의 증거가 아니다. CI gate, 새 harness 규칙, production sandbox 구현으로 등록하지 않는다.
외부 서비스 실행, 실제 지연·비용, 장시간 병렬 업무 및 사고 복구는 별도 증거가 필요하다.

실제 CLI/daemon KVM 실험의 image, seed, QEMU 인자, artifact deploy와 provider 구성은
[VM 재현 recipe](poc/vm-recipe.md)에 기록한다. 검증 manifest는 실제 QMP와 실행 프로세스
인자를 대조하며, 이미 준비된 guest에 접속하는 smoke 프로그램과 별개다.
