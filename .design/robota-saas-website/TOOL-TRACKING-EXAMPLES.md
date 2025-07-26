# Tool 추적 예시 (실제 데이터만)

## 🎯 핵심 원칙: 실제 데이터만 추적

**모든 예시는 실제 실행 데이터만을 기반으로 합니다.**
- ✅ 실제 시작/완료 시간
- ✅ 실제 입력 파라미터와 출력 결과
- ✅ 실제 소요 시간 측정
- ❌ 예상 진행률이나 가상 단계 없음

## 📋 핵심 시나리오 (실제 데이터 기반)

### 🔍 **1. Multi-Step Tool (webSearch)**

#### ⏰ 시작 시점:
```
📦 Agent 실행 (진행 중)
├── 💬 사용자 메시지: "최신 AI 트렌드 검색해줘"
└── 🔧 webSearch (진행 중)
    ├── 상태: in_progress
    ├── 시작 시간: 14:32:15 (실제)
    ├── 입력: { query: "AI trends 2024", limit: 10 } (실제)
    └── 실행 중... (완료까지 대기)
```

#### ⏰ 완료 후:
```
📦 Agent 실행 (진행 중)
├── 💬 사용자 메시지: "최신 AI 트렌드 검색해줘"
├── ✅ webSearch (완료)
│   ├── 시작: 14:32:15, 완료: 14:32:18 (실제 시간)
│   ├── 실행 시간: 3.2초 (실제 측정)
│   ├── 입력: { query: "AI trends 2024", limit: 10 } (실제)
│   └── 📄 결과: [
│       "GPT-4 Turbo 발표",
│       "Multimodal AI 발전",
│       "AI 규제 동향",
│       ...
│     ] (실제 검색 결과)
└── 🔄 LLM 응답 생성 중...
    ├── 상태: in_progress
    ├── 시작 시간: 14:32:18 (실제)
    └── 입력: webSearch 결과 + 사용자 질문 (실제)
```

#### ⏰ 최종 완료:
```
📦 Agent 실행 (완료)
├── 💬 사용자 메시지: "최신 AI 트렌드 검색해줘"
├── ✅ webSearch (완료)
│   ├── 시작: 14:32:15, 완료: 14:32:18
│   ├── 실행 시간: 3.2초
│   └── 결과: [실제 검색 결과 배열]
├── ✅ LLM 응답 (완료)
│   ├── 시작: 14:32:18, 완료: 14:32:23
│   ├── 실행 시간: 4.8초 (실제 측정)
│   └── 📄 응답: "2024년 주요 AI 트렌드는 다음과 같습니다..."
└── 총 실행 시간: 8초 (실제)
```

### 🧮 **2. Single-Step Tool (calculator)**

#### ⏰ 전체 과정 (빠른 실행):
```
📦 Agent 실행 (완료)
├── 💬 사용자 메시지: "25 * 47은 얼마야?"
├── ✅ calculator (완료)
│   ├── 시작: 14:35:10, 완료: 14:35:10 (즉시)
│   ├── 실행 시간: 0.05초 (실제 측정)
│   ├── 입력: { expression: "25 * 47" } (실제)
│   └── 📄 결과: 1175 (실제 계산 결과)
├── ✅ LLM 응답 (완료)
│   ├── 시작: 14:35:10, 완료: 14:35:12
│   ├── 실행 시간: 1.8초 (실제 측정)
│   └── 📄 응답: "25 × 47 = 1175입니다."
└── 총 실행 시간: 1.85초 (실제)
```

### 🔗 **3. MCP Tool (github-mcp)**

#### ⏰ 시작 시점:
```
📦 Agent 실행 (진행 중)
├── 💬 사용자 메시지: "robota 프로젝트의 최근 커밋을 보여줘"
└── 🔧 github-mcp (진행 중)
    ├── 상태: in_progress
    ├── 시작 시간: 14:40:05 (실제)
    ├── 입력: { 
    │   repo: "robota", 
    │   action: "get_recent_commits",
    │   limit: 5 
    │ } (실제)
    └── MCP 서버 연결 중... (실제 대기)
```

#### ⏰ 완료 후:
```
📦 Agent 실행 (진행 중)
├── 💬 사용자 메시지: "robota 프로젝트의 최근 커밋을 보여줘"
├── ✅ github-mcp (완료)
│   ├── 시작: 14:40:05, 완료: 14:40:08 (실제 시간)
│   ├── 실행 시간: 2.7초 (실제 측정)
│   ├── 입력: { repo: "robota", action: "get_recent_commits" } (실제)
│   └── 📄 결과: [
│       {
│         "hash": "a1b2c3d",
│         "message": "feat: add tool hooks support",
│         "author": "developer",
│         "date": "2024-01-15"
│       },
│       ...
│     ] (실제 GitHub API 응답)
└── 🔄 LLM 응답 생성 중...
    ├── 상태: in_progress
    ├── 시작 시간: 14:40:08 (실제)
    └── 입력: GitHub 커밋 데이터 + 사용자 질문 (실제)
```

#### ⏰ 최종 완료:
```
📦 Agent 실행 (완료)
├── 💬 사용자 메시지: "robota 프로젝트의 최근 커밋을 보여줘"
├── ✅ github-mcp (완료)
│   ├── 시작: 14:40:05, 완료: 14:40:08
│   ├── 실행 시간: 2.7초
│   └── 결과: [실제 GitHub 커밋 배열]
├── ✅ LLM 응답 (완료)
│   ├── 시작: 14:40:08, 완료: 14:40:12
│   ├── 실행 시간: 3.9초 (실제 측정)
│   └── 📄 응답: "robota 프로젝트의 최근 커밋 목록입니다..."
└── 총 실행 시간: 6.6초 (실제)
```

## 🔧 **Tool별 실행 패턴 요약**

### **Single-Step Tools**
- 즉시 실행 완료 (< 0.1초)
- 단순한 입력/출력
- 예: calculator, dateTime, randomGenerator

### **Multi-Step Tools** 
- 복잡한 처리 과정 (1-5초)
- API 호출이나 파일 처리
- 예: webSearch, fileSearch, weatherAPI

### **MCP Tools**
- 외부 서버 통신 (2-10초)
- 네트워크 지연 가능성
- 예: github-mcp, slack-mcp, database-mcp

## 💡 **핵심 구현 포인트**

### 1. **실제 시간 측정**
```typescript
// beforeExecute에서 시작 시간 기록
const startTime = new Date();

// afterExecute에서 실제 소요 시간 계산
const actualDuration = new Date().getTime() - startTime.getTime();
```

### 2. **LLM 응답 블록 자동 생성**
```typescript
// Tool 완료 즉시 LLM 블록 생성
afterExecute(toolName, parameters, result) {
  // Tool 블록 완료
  this.completeToolBlock(blockId, result);
  
  // LLM 블록 즉시 시작
  this.startLLMBlock(result, userMessage);
}
```

### 3. **실제 입력/출력 데이터만 기록**
```typescript
// 실제 Tool 파라미터와 결과만 저장
const blockData = {
  toolName: actualToolName,
  parameters: actualParameters, // 실제 입력
  result: actualResult, // 실제 출력
  startTime: actualStartTime,
  endTime: actualEndTime
};
```

### 4. **Tool 타입별 분류**
```typescript
const getToolType = (toolName: string): 'single' | 'multi' | 'mcp' => {
  // 실제 Tool 이름으로 타입 판별
  if (['calculator', 'dateTime'].includes(toolName)) return 'single';
  if (['webSearch', 'fileSearch'].includes(toolName)) return 'multi';
  if (toolName.includes('-mcp')) return 'mcp';
  return 'single'; // 기본값
};
```

이 방식으로 **가짜 정보 없이 실제 Tool 실행 과정을 정확하게 추적**할 수 있습니다! 🎯 