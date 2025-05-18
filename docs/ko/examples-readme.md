# Robota 예제 모음

이 폴더에는 Robota 라이브러리의 다양한 기능을 보여주는 예제 코드가 포함되어 있습니다.

## 시작하기 전에

예제를 실행하기 전에 다음 단계를 따르세요:

1. 필요한 의존성 설치:

```bash
pnpm install
```

2. 환경 변수 설정:

`.env` 파일을 프로젝트 루트에 생성하고 필요한 API 키를 설정하세요:

```
OPENAI_API_KEY=your_openai_api_key_here
WEATHER_API_KEY=your_weather_api_key_here  # 옵션: 날씨 예제에 사용
```

## 예제 구성

### 기본 예제

- [`basic/simple-conversation.ts`](../apps/examples/basic/simple-conversation.ts): 기본적인 대화 및 스트리밍 응답 사용법
- [`basic/simple-features.ts`](../apps/examples/basic/simple-features.ts): Robota의 간단한 사용 예제와 기본 도구 사용법
- [`basic/basic-features.ts`](../apps/examples/basic/basic-features.ts): Robota의 기본적인 함수 호출 예제 
- [`basic/advanced-features.ts`](../apps/examples/basic/advanced-features.ts): 다양한 함수 호출과 스트리밍 응답을 활용한 여행 계획 도우미

### 함수 호출 예제

- [`function-calling/weather-calculator.ts`](../apps/examples/function-calling/weather-calculator.ts): 날씨 정보 조회 및 계산기 기능 구현

### 도구 사용 예제

- [`tools/tool-examples.ts`](../apps/examples/tools/tool-examples.ts): zod를 사용한 도구 정의 및 사용 방법

### 에이전트 예제

- [`agents/research-agent.ts`](../apps/examples/agents/research-agent.ts): 검색, 요약, 번역 기능을 갖춘 리서치 에이전트

### 시스템 메시지 예제

- [`system-messages/system-messages.ts`](../apps/examples/system-messages/system-messages.ts): 다양한 시스템 메시지 템플릿 활용 예제

## 예제 실행 방법

각 예제는 다음 명령으로 실행할 수 있습니다:

```bash
# 루트 디렉토리에서 실행
pnpm run example:basic
pnpm run example:function-calling
pnpm run example:tools
pnpm run example:agents
pnpm run example:system-messages
pnpm run example:all

# 또는 apps/examples 디렉토리에서 직접 실행
cd apps/examples
pnpm run start:basic
pnpm run start:function-calling
pnpm run start:tools
pnpm run start:agents
pnpm run start:system-messages
pnpm run start:all

# 코드 lint 검사
pnpm run lint
pnpm run lint:fix
```

## 예제 확장하기

이 예제들은 Robota 라이브러리의 기본 기능을 보여주는 간단한 데모입니다. 다음과 같은 방식으로 예제를 확장할 수 있습니다:

1. 실제 API 통합: 가상 데이터 대신 실제 외부 API와 통합
2. 더 복잡한 도구 추가: 파일 시스템 액세스, 데이터베이스 연결 등
3. 고급 에이전트 패턴 구현: ReAct, 다중 에이전트 협업 등
4. UI 추가: 웹 인터페이스 또는 CLI를 통한 상호작용

## 도움말 및 문제 해결

예제 실행 중 문제가 발생하면 다음을 확인하세요:

1. 모든 필요한 의존성이 설치되었는지 확인
2. API 키가 올바르게 설정되었는지 확인
3. 최신 버전의 Node.js를 사용 중인지 확인 (v18 이상 권장)

자세한 설명과 가이드는 [문서 사이트의 예제 가이드](./examples.md)를 참조하세요.

추가 도움이 필요하면 [GitHub Issues](https://github.com/woojubb/robota/issues)에 문의하세요. 