# Tool별 트래킹 트리 구조 예시

## 🎯 개요

다양한 Tool 타입별로 어떤 형태의 트래킹 트리가 생성되는지 보여주는 핵심 예시입니다. 모든 Tool 실행 후에는 LLM이 결과를 받아 최종 응답을 생성하는 단계가 포함됩니다.

## 📋 Tool 분류 및 특징

### 1. 복잡한 Tool (Multi-Step)
- **webSearch, fileSearch** 등 - 여러 단계 실행 계획

### 2. 단순한 Tool (Single-Step)  
- **calculator, dateTime** 등 - 즉시 결과 반환

### 3. MCP Tool (Third-party)
- **github-mcp** 등 - 외부 서비스 연동

## 🔧 Multi-Step Tool 예시 (webSearch)

### 시나리오: "최신 AI 트렌드 검색해줘"

##### ⏰ webSearch 진행 중 (2초):
```
📦 Agent 실행 (진행 중)
├── 💬 사용자 메시지: "최신 AI 트렌드 검색해줘"
└── 🔧 webSearch (진행 중 - 50%)
    ├── 상태: in_progress, 현재 단계: 2/4
    ├── ✅ 1. 쿼리 처리 (완료): "AI trends 2024 machine learning"
    ├── 🔄 2. 웹 요청 (진행 중): "Google Search API 호출 중..."
    ├── ⏳ 3. 결과 파싱 (대기)
    └── ⏳ 4. 관련성 필터링 (대기)
```

##### ⏰ webSearch 완료, LLM 응답 생성 (5초):
```
📦 Agent 실행 (진행 중)
├── 💬 사용자 메시지: "최신 AI 트렌드 검색해줘"
├── ✅ webSearch (완료)
│   ├── 상태: completed, 실행 시간: 5초
│   ├── ✅ 1. 쿼리 처리: "AI trends 2024 machine learning"
│   ├── ✅ 2. 웹 요청: "10개 결과 수신"
│   ├── ✅ 3. 결과 파싱: "HTML → 구조화된 데이터"
│   ├── ✅ 4. 관련성 필터링: "5개 관련 결과 선별"
│   └── 📄 결과: ["GPT-4 발전사항", "멀티모달 AI", "AI 윤리", ...]
└── 🔄 LLM 응답 생성 중...
    ├── 상태: in_progress
    ├── 입력: webSearch 결과 + 사용자 질문
    └── 진행: "검색 결과를 바탕으로 AI 트렌드 정리 중..."
```

##### ⏰ 최종 완료 (8초):
```
📦 Agent 실행 (완료 ✅)
├── 💬 사용자 메시지: "최신 AI 트렌드 검색해줘"
├── ✅ webSearch (완료)
│   ├── 실행 시간: 5초
│   └── 📄 결과: ["GPT-4 발전사항", "멀티모달 AI", "AI 윤리", ...]
└── ✅ LLM 응답 (완료)
    ├── 실행 시간: 3초
    └── 💭 최종 응답: "2024년 AI 트렌드는 다음과 같습니다: 1. GPT-4의 멀티모달 기능 확장..."
```

## 🧮 Single-Step Tool 예시 (calculator)

### 시나리오: "15% 할인된 가격이 $85라면 원래 가격은?"

##### ⏰ calculator 완료, LLM 응답 생성 (0.1초):
```
📦 Agent 실행 (진행 중)
├── 💬 사용자 메시지: "15% 할인된 가격이 $85라면 원래 가격은?"
├── ✅ calculator (완료)
│   ├── 실행 시간: 0.1초
│   ├── 매개변수: { expression: "85 / (1 - 0.15)" }
│   └── 📄 결과: "$100.00"
└── 🔄 LLM 응답 생성 중...
    ├── 상태: in_progress
    └── 진행: "계산 결과를 바탕으로 설명 생성 중..."
```

##### ⏰ 최종 완료 (2초):
```
📦 Agent 실행 (완료 ✅)
├── 💬 사용자 메시지: "15% 할인된 가격이 $85라면 원래 가격은?"
├── ✅ calculator (완료)
│   ├── 실행 시간: 0.1초
│   └── 📄 결과: "$100.00"
└── ✅ LLM 응답 (완료)
    ├── 실행 시간: 1.9초
    └── 💭 최종 응답: "계산 결과, 원래 가격은 $100.00입니다. 85 ÷ (1 - 0.15) = 85 ÷ 0.85 = 100"
```

## 🔌 MCP Tool 예시 (github-mcp)

### 시나리오: "GitHub에서 최신 이슈 확인해줘"

##### ⏰ github-mcp 진행 중 (3초):
```
📦 Agent 실행 (진행 중)
├── 💬 사용자 메시지: "GitHub에서 최신 이슈 확인해줘"
└── 🔧 github-mcp (진행 중 - 75%)
    ├── 상태: in_progress, 현재 단계: 3/4
    ├── 매개변수: { repo: "user/project", filter: "open", limit: 10 }
    ├── ✅ 1. 인증 확인: "GitHub API 토큰 검증 완료"
    ├── ✅ 2. API 요청: "GET /repos/user/project/issues"
    ├── 🔄 3. 데이터 처리 (진행 중): "이슈 메타데이터 파싱 중..."
    └── ⏳ 4. 결과 포맷팅 (대기)
```

##### ⏰ github-mcp 완료, LLM 응답 생성 (4초):
```
📦 Agent 실행 (진행 중)
├── 💬 사용자 메시지: "GitHub에서 최신 이슈 확인해줘"
├── ✅ github-mcp (완료)
│   ├── 실행 시간: 4초
│   ├── ✅ 1. 인증 확인: "GitHub API 토큰 검증 완료"
│   ├── ✅ 2. API 요청: "GET /repos/user/project/issues"
│   ├── ✅ 3. 데이터 처리: "10개 이슈 메타데이터 추출"
│   ├── ✅ 4. 결과 포맷팅: "사용자 친화적 형태로 변환"
│   └── 📄 결과: [
│       "Issue #123: 로그인 버그 수정 필요",
│       "Issue #122: 새로운 기능 요청 - 다크모드",
│       "Issue #121: 성능 최적화 필요", ...
│   ]
└── 🔄 LLM 응답 생성 중...
    ├── 상태: in_progress
    └── 진행: "GitHub 이슈 정보를 정리하여 응답 생성 중..."
```

##### ⏰ 최종 완료 (7초):
```
📦 Agent 실행 (완료 ✅)
├── 💬 사용자 메시지: "GitHub에서 최신 이슈 확인해줘"
├── ✅ github-mcp (완료)
│   ├── 실행 시간: 4초
│   └── 📄 결과: [이슈 10개 목록]
└── ✅ LLM 응답 (완료)
    ├── 실행 시간: 3초
    └── 💭 최종 응답: "프로젝트의 최신 이슈를 확인했습니다. 주요 이슈는: 1. 로그인 버그 (#123) - 긴급 수정 필요..."
```

## 📋 Tool별 실행 패턴 요약

### 1. Multi-Step Tool (webSearch, github-mcp)
1. **Tool 실행**: 여러 단계 진행 (3-4단계)
2. **Tool 완료**: 구조화된 데이터 결과 생성
3. **LLM 응답**: Tool 결과를 바탕으로 사용자 친화적 응답 생성
4. **최종 완료**: 전체 실행 완료

### 2. Single-Step Tool (calculator, dateTime)
1. **Tool 실행**: 즉시 완료 (0.1초 미만)
2. **LLM 응답**: Tool 결과를 바탕으로 설명 포함 응답 생성
3. **최종 완료**: 전체 실행 완료

### 3. 공통 패턴
- **모든 Tool 실행 후**: LLM이 결과를 받아 최종 응답 생성
- **LLM 응답 단계**: Tool 결과 + 사용자 질문을 바탕으로 설명 추가
- **최종 완료**: Tool 결과와 LLM 응답이 모두 완료된 상태

## 🎯 핵심 구현 포인트

### 1. LLM 응답 노드 생성
```typescript
// Tool 완료 후 자동으로 LLM 응답 노드 생성
function onToolCompleted(toolNodeId: string, toolResult: any) {
  const llmNodeId = TrackingTree.createLLMResponseNode({
    parentId: getAgentNodeId(toolNodeId),
    inputData: {
      toolResult,
      userMessage: getUserMessage(toolNodeId),
      context: getConversationContext(toolNodeId)
    }
  });
  
  // LLM 처리 시작
  startLLMProcessing(llmNodeId);
}
```

### 2. Tool 타입별 자동 분류
```typescript
// Tool 이름으로 실행 계획 자동 결정
function getToolExecutionPlan(toolName: string): ToolExecutionPlan {
  const patterns = {
    single: ['calculator', 'dateTime', 'randomGenerator'],
    api: ['webSearch', 'weatherAPI', 'github-mcp'],
    file: ['fileSearch', 'codeAnalysis']
  };
  
  if (patterns.single.includes(toolName)) {
    return createSingleStepPlan();
  } else if (patterns.api.includes(toolName)) {
    return createApiCallPlan();
  } else {
    return createDefaultPlan();
  }
}
```

## ✅ 핵심 원칙

1. **완전한 실행 흐름**: Tool 실행 → Tool 완료 → LLM 응답 → 최종 완료
2. **일관성**: 모든 Tool은 동일한 노드 구조로 추적 (복잡도 무관)
3. **LLM 응답 필수**: 모든 Tool 실행 후 LLM이 결과를 받아 최종 응답 생성
4. **실시간성**: Tool과 LLM 응답의 모든 상태 변화를 실시간 반영
5. **직관성**: 사용자가 Tool → LLM → 응답 흐름을 명확히 파악 가능

이 3개 핵심 예시로 모든 Tool 타입의 추적 패턴을 커버할 수 있습니다. 