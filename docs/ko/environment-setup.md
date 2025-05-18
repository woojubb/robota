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

Robota는 다양한 예제를 제공합니다. 다음 명령어로 실행할 수 있습니다:

```bash
# 기본 예제
pnpm example:basic

# 함수 호출 예제
pnpm example:function-calling

# 도구 사용 예제
pnpm example:tools

# 에이전트 예제
pnpm example:agents

# 모든 예제 실행
pnpm example:all
```

## 프로젝트 구조

```
robota/
├── packages/           # 핵심 패키지들
│   ├── core/           # 코어 기능
│   ├── openai/         # OpenAI 제공자
│   ├── anthropic/      # Anthropic 제공자
│   └── ...
├── src/                # 소스 코드
│   ├── core/           # 코어 구현체
│   ├── agents/         # 에이전트 구현체
│   ├── examples/       # 예제 (실행 가능)
│   └── ...
├── examples/           # 추가 예제 (문서용)
├── docs/               # 문서
└── apps/               # 응용 프로그램
    └── web/            # 웹 애플리케이션
```

## 참고 사항

- 패키지 참조는 `@robota-sdk/core`, `@robota-sdk/openai` 등의 형식을 사용합니다.
- pnpm 워크스페이스를 사용하여 패키지 간 의존성을 관리합니다.
- 플랫폼 간 호환성을 보장하기 위해 심볼릭 링크를 사용하지 마세요. 대신 파일을 복사하거나 상대 경로를 사용해 참조하세요. 