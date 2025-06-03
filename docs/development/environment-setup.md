# Robota 개발 환경 설정

Robota 프로젝트는 pnpm 워크스페이스를 사용하는 모노레포 구조로 구성되어 있으며, bun을 사용하여 예제를 실행합니다.

## 필수 도구

Robota 개발을 위해 다음 도구들이 필요합니다:

- [Node.js](https://nodejs.org/) v18 이상
- [pnpm](https://pnpm.io/) v8 이상
- [Bun](https://bun.sh/) v1 이상

## 설치 방법

### pnpm 설치

```bash
# npm을 통한 설치
npm install -g pnpm

# macOS (Homebrew)
brew install pnpm
```

### Bun 설치

```bash
# macOS, Linux
curl -fsSL https://bun.sh/install | bash

# Windows (with WSL)
curl -fsSL https://bun.sh/install | bash
```

## 프로젝트 설정

1. 저장소 클론 및 의존성 설치:

```bash
git clone https://github.com/woojubb/robota.git
cd robota
pnpm install
```

2. 패키지 빌드:

```bash
pnpm build
```

## 예제 실행

모든 예제는 `apps/examples` 디렉토리에 위치합니다. 먼저 해당 디렉토리로 이동하세요:

```bash
cd apps/examples
```

### 방법 1: 패키지 스크립트 사용

```bash
# 개별 예제 실행
pnpm start:simple-conversation
pnpm start:using-ai-client
pnpm start:multi-ai-providers
pnpm start:provider-switching
pnpm start:zod-function-provider
pnpm start:using-tool-providers

# 예제 그룹 실행
pnpm start:all-basic          # 모든 기본 예제
pnpm start:all-tool-providers # 모든 도구 제공자 예제
pnpm start:all-examples       # 모든 예제 순차 실행
pnpm start:all                # 빠른 데모
```

### 방법 2: 직접 파일 실행

```bash
# bun 사용 (가장 빠름)
bun run 01-basic/01-simple-conversation.ts
bun run 01-basic/02-ai-with-tools.ts
bun run 01-basic/03-multi-ai-providers.ts

# pnpm + tsx 사용
pnpm tsx 01-basic/01-simple-conversation.ts
pnpm tsx 02-functions/01-zod-function-tools.ts
pnpm tsx 03-integrations/01-mcp-client.ts
```

## 프로젝트 구조

```
robota/
├── packages/           # 핵심 패키지
│   ├── core/           # 코어 기능
│   ├── openai/         # OpenAI 통합
│   ├── anthropic/      # Anthropic 통합
│   ├── mcp/            # MCP 구현
│   ├── tools/          # 도구 시스템
│   └── ...
└── apps/               # 응용 프로그램
    ├── docs/           # 문서 애플리케이션
    └── examples/       # 예제 코드
```

## 참고 사항

- 패키지 참조는 `@robota-sdk/core`, `@robota-sdk/openai` 등의 형식을 사용합니다.
- pnpm 워크스페이스를 사용하여 패키지 간 의존성을 관리합니다.
- 플랫폼 간 호환성을 보장하기 위해 심볼릭 링크를 사용하지 마세요. 대신 파일을 복사하거나 상대 경로를 사용해 참조하세요. 