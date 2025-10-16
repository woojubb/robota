# 현재 진행 작업 (1-2주 목표)

> 즉시 실행해야 할 핵심 작업들입니다. 우선순위 순으로 정렬되어 있습니다.

## 📅 업데이트: 2025-10-16

---

## 🔥 Priority 1: Agent Event Normalization (진행중)

### 완료된 단계
- [x] 단계 1: Agent가 스스로 올바른 이벤트 emit 보장
- [x] 단계 2: Agent.created에서 Agent 노드 생성
- [x] 단계 4: Tool 핸들러의 Agent 노드 중복 생성 방지
- [x] 단계 5: 도구측 대리 이벤트 발행 제거
- [x] 단계 6: 예제 26 동작/데이터 동등성 확인
- [x] 단계 7: 최종 정리 (Tool 핸들러 분기 삭제)

### 남은 작업

#### 단계 3: execution_start 상태 전이 우선 (하위 호환)
- [ ] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `agent.execution_start` 수신 시:
    - [ ] 기존 Agent 노드 있으면 status=running 등 상태만 갱신
    - [ ] 기존 Agent 노드 없을 때만 "임시 생성" (하위 호환용)
- [ ] 빌드/가드/검증 실행
- [ ] Agent 노드 수 점검(중복 증가 없음)

#### 단계 6.5: 단일 전환 단계 (Decision Gate)
- [ ] Agent 핸들러: `agent.execution_start`는 상태 전이만 (노드 생성 절대 금지)
- [ ] 단계 3의 "없을 때만 임시 생성" 하위호환 로직 완전 제거
- [ ] 팀/툴 발행자: `tool.agent_execution_started` emit 완전 제거
- [ ] 상수 제거: `packages/team/src/events/constants.ts`
- [ ] 빌드/가드/검증 (원샷 검증)

#### 단계 6.6: Fork/Join round2 thinking 연결 교정
- [ ] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `execution.assistant_message_start`에서 연결 소스 결정 규칙 교정
  - [ ] 동일 `rootExecutionId` 내 최신 thinking 노드 찾기 (Path-Only)
  - [ ] `tool_result` 중 `parentThinkingNodeId` 일치하면 `analyze` 엣지
  - [ ] 미발견 시 `user_message → thinking` (processes)
- [ ] 빌드/가드/검증
- [ ] round2 연결 검증: `tool_result → thinking_round2 (analyze)`

#### 단계 8: Subscriber Path Map Reader (선택, 우선순위 낮음)
- [ ] `PathMapReader` 객체 설계 (읽기 전용)
- [ ] 명시 필드만으로 인덱스 구축
- [ ] Agent 핸들러 등에 적용
- [ ] `getAllNodes()` 직접 스캔과 결과 동등성 검증

### 검증 명령어
```bash
pnpm --filter @robota-sdk/workflow build && \
pnpm --filter @robota-sdk/team build && \
pnpm --filter @robota-sdk/agents build && \
cd apps/examples && \
FILE=26-playground-edge-verification.ts && \
HASH=$(md5 -q "$FILE") && \
OUT=cache/26-playground-edge-verification-$HASH-guarded.log && \
echo "▶️ Run example (guarded)..." && \
STATUS=0; npx tsx "$FILE" > "$OUT" 2>&1 || STATUS=$?; \
tail -n 160 "$OUT" | cat; \
if [ "$STATUS" -ne 0 ] || grep -E "\\[STRICT-POLICY\\]|\\[EDGE-ORDER-VIOLATION\\]" "$OUT" >/dev/null; then \
  echo "❌ Aborting verification (example failed or strict-policy violation)."; \
  exit ${STATUS:-1}; \
fi; \
echo "▶️ Verify..." && \
npx tsx utils/verify-workflow-connections.ts | cat
```

---

## 🔧 Priority 2: Fork/Join Path-Only 마무리

### A-1. ExecutionService path 자동 주입/검증 강화
- [ ] `packages/agents/src/services/execution-service.ts`
  - [ ] emit 전 path 검증 로직 추가
  - [ ] clone tail(required) 누락 시 즉시 throw
  - [ ] 검증 에러 메시지 표준화

### A-2. WorkflowState 경량화
- [ ] `packages/workflow/src/services/workflow-state.ts`
  - [ ] 보류/임시 큐/배리어 관련 상태·API 제거
  - [ ] Path-Only 원칙에 맞게 단순화

### A-3. 이벤트 소유권 정비
- [ ] `execution.*` 이벤트의 단일 소유권을 `ExecutionService`로 고정
- [ ] 타 모듈 emit 금지 확인 (전역 검사)
- [ ] ESLint 룰 추가: "ExecutionService 외 `execution.*` emit 금지"

### A-4. EventService Prefix Injection (도입 제안)
- [ ] EventService 생성자/clone API에 `ownerPrefix` 옵션 추가
- [ ] 상위 컨테이너 → 하위 객체 생성 시 `clone({ ownerPrefix })` 체인
- [ ] 검증 에러 메시지 표준화

### A-5. Continued Conversation Path-Only
- [ ] ExecutionService(user_message) path = [rootId, executionId] 보장
- [ ] `response(last) → user_message(continues) → thinking(processes)` 시퀀스
- [ ] 예제 27 재검증

---

## 🎨 Priority 3: Playground Tools DnD

### B-1. 브릿지/레지스트리 보강
- [ ] `apps/web/src/lib/playground/robota-executor.ts`
  - [ ] executor 에러를 UI 표준 에러로 변환

### B-2. Tools 목록 관리(UI)
- [ ] `ToolItem` 타입 선언 및 유효성 체크
- [ ] `toolItems` 상태 초기값 및 setter
- [ ] 사이드바 카드 리스트 렌더 (스크롤/접근성)
- [ ] `+ Add Tool` 모달 (name, description)
- [ ] ID 생성 규칙 (kebab + 6자리 토큰) 및 중복 방지
- [ ] 추가 후 정렬 및 포커스 이동
- [ ] 삭제/이름변경 (선택)

### B-3. DnD 상호작용 보강
- [ ] 빠른 연속 드롭 디바운스
- [ ] 중복 드롭 시 UI 유지

### B-4. UI 오버레이 상태 (addedToolsByAgent)
- [ ] 타입 정의: `AddedToolsByAgent = Record<AgentId, string[]>`
- [ ] 상위 페이지 상태 `addedToolsByAgent` 구현
- [ ] `onToolDrop(agentId, tool)` 집합 추가
- [ ] `WorkflowVisualization`에 props 전달
- [ ] `AgentNode` 렌더 시 합집합 뱃지 표시
- [ ] 병합 규칙: SDK 도구 ∪ 오버레이 도구
- [ ] 성공/실패 토스트 표준화

### B-5. 수용 기준
- [ ] 드래그 시 Agent 노드 시각적 반응
- [ ] 드롭 시 툴 뱃지 즉시 추가 (중복 없음)
- [ ] Workflow Path-Only 보존

---

## 🗑️ Priority 4: Pricing 기능 제거 (무료 플랫폼 전환)

### Phase 1: Pricing UI 제거
- [ ] `/pricing` 라우트 및 관련 컴포넌트 삭제
- [ ] Header/Navigation에서 Pricing 링크 제거
- [ ] 모든 "Upgrade" 프롬프트 및 버튼 제거
- [ ] Dashboard에서 Plan 정보 섹션 제거

### Phase 2: Billing 로직 제거
- [ ] `/api/v1/billing/*`, `/api/v1/subscriptions/*` 엔드포인트 삭제
- [ ] `types/billing.ts` 및 관련 타입 제거
- [ ] `lib/billing/plans.ts`에서 paid plan 제거 (free만 유지)
- [ ] Firebase billing 컬렉션 사용 중단

### Phase 3: 무료 크레딧 시스템 전환
- [ ] `UserCredit` 타입 단순화
- [ ] Plan 기반 → 크레딧 기반 제한 로직 변경
- [ ] Usage Dashboard "Plan limits" → "Free usage limits"
- [ ] 제한 도달 시 친화적 메시지 (업그레이드 언급 제거)

### Phase 4: 설정 정리
- [ ] Stripe 관련 환경 변수 제거
- [ ] API 문서에서 billing 엔드포인트 제거
- [ ] 사용하지 않는 billing 타입 및 테스트 정리

---

## ✅ 성공 기준

### Agent Event Normalization
- [ ] Agent 노드 생성은 오직 `agent.created`
- [ ] `agent.execution_start`는 상태 전이만
- [ ] `tool.agent_execution_started` 완전 제거
- [ ] 예제 26 가드/검증 통과
- [ ] 하드코딩 문자열 없음 (상수만 사용)
- [ ] Fork/Join 다중 depth Path-Only 연결

### Fork/Join Path-Only
- [ ] `groupId`/`branchId`/`responseExecutionId` 제거
- [ ] WorkflowState 경량화 완료
- [ ] 이벤트 소유권 ESLint 룰 적용
- [ ] Continued Conversation 예제 27 통과

### Tools DnD
- [ ] 드래그앤드롭 동작 안정적
- [ ] 툴 뱃지 정확히 표시
- [ ] 중복/간섭 없음
- [ ] Path-Only 보존

### Pricing 제거
- [ ] UI에서 모든 pricing/billing 언급 제거
- [ ] API 엔드포인트 정리
- [ ] 무료 크레딧 시스템 동작
- [ ] Stripe 의존성 제거

---

## 📝 작업 진행 기록

**시작일**: 2025-10-16
**예상 완료**: 2025-10-30 (2주)

**주요 이슈**:
- Agent Event Normalization 85% 완료
- Fork/Join Path-Only 기초 완성, 정리 필요
- Tools DnD UI 작업 대기
- Pricing 제거는 독립적으로 진행 가능

**다음 단계**:
1. Agent Event Normalization 단계 3, 6.5, 6.6 완료
2. Fork/Join Path-Only 검증 스크립트 자동화
3. Tools DnD UI 구현 시작
4. Pricing 제거 (병렬 작업 가능)

