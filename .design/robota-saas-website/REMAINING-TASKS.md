## 🚨 **절대 바꿀 수 없는 전제조건**

### **🎯 한 줄기에서 시작하는 Tree 구조 (절대조건)**

**반드시 달성해야 하는 구조**:
```
📋 user.message (Level 0) ← 사용자 프롬프트에서 시작
├── 🤖 assistant.message_start (Level 1)
├── 🔧 tool_call_start (Level 1, assignTask #1)
│   ├── 📋 team.analysis_start (Level 2)
│   ├── 📋 team.analysis_complete (Level 2)  
│   ├── 🤖 agent.creation_start (Level 2)
│   ├── 🤖 agent.creation_complete (Level 2)
│   ├── ▶️ agent.execution_start (Level 2)
│   ├── ▶️ agent.execution_complete (Level 2)
│   ├── 📊 task.aggregation_start (Level 2)
│   └── 📊 task.aggregation_complete (Level 2)
├── 🔧 tool_call_complete (Level 1, assignTask #1)
├── 🔧 tool_call_start (Level 1, assignTask #2)
│   ├── 📋 team.analysis_start (Level 2)
│   ├── 📋 team.analysis_complete (Level 2)
│   ├── 🤖 agent.creation_start (Level 2)
│   ├── 🤖 agent.creation_complete (Level 2)
│   ├── ▶️ agent.execution_start (Level 2)
│   ├── ▶️ agent.execution_complete (Level 2)
│   ├── 📊 task.aggregation_start (Level 2)
│   └── 📊 task.aggregation_complete (Level 2)
├── 🔧 tool_call_complete (Level 1, assignTask #2)
├── 📨 tool_results_to_llm (Level 1) ← 도구 결과를 LLM에 제시
└── 🤖 assistant.message_complete (Level 1) ← 최종 LLM 응답
```

**핵심 원칙**: 
- ✅ **단일 시작점**: user.message에서 모든 것이 시작
- ✅ **연속적인 분기**: 각 분기의 모든 하위 이벤트가 해당 분기 아래 순차 배치
- ✅ **완전한 대화 흐름**: 사용자 프롬프트 → LLM tool calls → 도구 실행 → 결과 제시 → 최종 응답
- ✅ **절대 분리 금지**: ROOT나 별도 parent에 이벤트 분리 절대 불가

---

## 🚨 **현재 문제: 잘못된 Tree 구조**

### **❌ 현재 출력된 잘못된 구조**
```
📦 Parent: exec_1753808133835_8lsveqmgw
    ├── call_6nJbedpQa5jdLIM1K5j0Cl0P (Level: 2)   ← assignTask #1만 여기
    └── call_M6ntdFYzECv2sPuCUE7EtEzw (Level: 2)   ← assignTask #2만 여기

📦 Parent: ROOT (완전히 분리됨!)
    ├── mapping-agent-1753808138011-e6ns4le0i (Level: 2)  ← Agent들이 엉뚱한 곳
    ├── mapping-agent-1753808138016-nespsy32t (Level: 2)
    └── mapping-task-aggregator (Level: 2)
```

### **✅ 사용자가 요구하는 올바른 구조**
```
📋 execution.start (Level 0, conversation) ← 하나의 시작점
├── 🔧 tool_call_start (Level 1, assignTask #1)
│   ├── 📋 team.analysis_start (Level 2)
│   ├── 📋 team.analysis_complete (Level 2)
│   ├── 🤖 agent.creation_start (Level 2)
│   ├── 🤖 agent.creation_complete (Level 2)
│   ├── ▶️ agent.execution_start (Level 2)
│   ├── ▶️ agent.execution_complete (Level 2)
│   ├── 📊 task.aggregation_start (Level 2)
│   └── 📊 task.aggregation_complete (Level 2)
├── 🔧 tool_call_complete (Level 1, assignTask #1)
├── 🔧 tool_call_start (Level 1, assignTask #2)
│   ├── 📋 team.analysis_start (Level 2)
│   ├── 📋 team.analysis_complete (Level 2)
│   ├── 🤖 agent.creation_start (Level 2)
│   ├── 🤖 agent.creation_complete (Level 2)
│   ├── ▶️ agent.execution_start (Level 2)
│   ├── ▶️ agent.execution_complete (Level 2)
│   ├── 📊 task.aggregation_start (Level 2)
│   └── 📊 task.aggregation_complete (Level 2)
├── 🔧 tool_call_complete (Level 1, assignTask #2)
└── 📝 execution.complete (Level 0, conversation)
```

### **🎯 핵심 문제점**
1. **Agent 이벤트들이 해당 assignTask call 하위에 위치하지 않음**
2. **각 분기가 연속적인 배열로 구성되지 않음**
3. **하나의 줄기에서 시작하는 구조가 아님**

---

## 📋 **긴급 수정 Task 목록**

### **Phase 1: 완전한 대화 흐름 이벤트 구조 구현**
- [ ] **사용자 메시지 이벤트 추가**: user.message가 최상위 시작점이 되도록 수정
- [ ] **LLM 응답 시작/완료 이벤트 추가**: assistant.message_start, assistant.message_complete 이벤트 구현
- [ ] **도구 결과 제시 이벤트 추가**: tool_results_to_llm 이벤트로 도구 실행 결과가 LLM에 전달되는 과정 추적
- [ ] **대화 흐름 순서 보장**: 
  ```
  user.message → assistant.message_start → tool_calls → tool_results_to_llm → assistant.message_complete
  ```
- [ ] **Agent 이벤트 parent 수정**: `mapping-agent-*` 이벤트들이 `ROOT` 대신 해당 `tool_call_start` ID를 parent로 가지도록 수정
- [ ] **Context 전달 체인 강화**: tool call ID가 Agent 생성/실행 이벤트까지 전달되도록 수정

### **Phase 2: 이벤트 순서 및 구조 수정**
- [ ] **tool_call_start/complete 순서 조정**: 각 assignTask의 start와 complete 사이에 해당 Agent 이벤트들이 위치하도록 수정
- [ ] **Level 계산 정확화**: 
  - Level 0: conversation start
  - Level 1: tool_call_start/complete
  - Level 2: 각 tool call 하위의 모든 Agent 이벤트들
- [ ] **병렬 실행을 순차적 Tree로 표현**: 실제로는 병렬로 실행되지만 Tree에서는 순차적으로 보이도록 조정

### **Phase 3: ActionTrackingEventService 수정**
- [ ] **`findExecutionId()` 개선**: Team 이벤트들이 올바른 tool call ID를 parent로 찾도록 수정
- [ ] **`enrichWithHierarchy()` 로직 수정**: Agent 이벤트들이 해당 assignTask의 Level 2로 정확히 배치되도록 수정
- [ ] **Hierarchy Map 구조 개선**: 분리된 parent들 대신 연속적인 Tree 구조로 매핑

### **Phase 4: 검증 및 테스트**
- [ ] **Tree 구조 정확성 검증**: Raw hierarchy data에서 연속적인 분기 구조 확인
- [ ] **이벤트 순서 검증**: tool_call_start → [8개 하위 이벤트] → tool_call_complete 순서 확인
- [ ] **Level 할당 검증**: 각 이벤트가 올바른 Level에 배치되었는지 확인

---

## 🎯 **성공 조건 (정확한 결과물)**

### **최종 출력되어야 하는 Tree 구조 (한 줄기)**
```
🌳 Tree Structure by Parent:

📦 Parent: ROOT ← 절대조건: 단일 시작점
    └── user.message (Level 0) ← 사용자 프롬프트
        ├── assistant.message_start (Level 1)
        ├── tool_call_start_assignTask1 (Level 1)
        │   ├── team.analysis_start (Level 2)
        │   ├── team.analysis_complete (Level 2)
        │   ├── agent.creation_start (Level 2)
        │   ├── agent.creation_complete (Level 2)
        │   ├── agent.execution_start (Level 2)
        │   ├── agent.execution_complete (Level 2)
        │   ├── task.aggregation_start (Level 2)
        │   └── task.aggregation_complete (Level 2)
        ├── tool_call_complete_assignTask1 (Level 1)
        ├── tool_call_start_assignTask2 (Level 1)
        │   ├── team.analysis_start (Level 2)
        │   ├── team.analysis_complete (Level 2)
        │   ├── agent.creation_start (Level 2)
        │   ├── agent.creation_complete (Level 2)
        │   ├── agent.execution_start (Level 2)
        │   ├── agent.execution_complete (Level 2)
        │   ├── task.aggregation_start (Level 2)
        │   └── task.aggregation_complete (Level 2)
        ├── tool_call_complete_assignTask2 (Level 1)
        ├── tool_results_to_llm (Level 1)
        └── assistant.message_complete (Level 1)
```

### **절대조건 검증 기준**
1. ✅ **단일 시작점**: user.message 하나에서만 시작
2. ✅ **완전한 대화 흐름**: 사용자 메시지 → LLM 응답 시작 → 도구 호출들 → 도구 결과 제시 → LLM 최종 응답
3. ✅ **연속적인 분기**: 각 tool_call_start 하위에 해당 Agent의 모든 이벤트가 순차적으로 배치
4. ✅ **분리 금지**: 어떤 이벤트도 ROOT나 별도 parent에 분리되어 있으면 안됨
5. ✅ **Level 정확성**: Level 0(user) → Level 1(assistant/tools) → Level 2(agents)

---

## ⚠️ **중요 제약사항**
- **기존 코드 최소 수정**: 이미 작업한 내용을 최대한 보존
- **Zero Breaking Change**: 기존 API 호환성 유지
- **토큰 효율성**: 불필요한 시행착오 방지
- **정확한 결과물 달성**: 위 성공 조건을 100% 만족하는 구조 구현 