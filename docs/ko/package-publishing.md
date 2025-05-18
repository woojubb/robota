---
title: 패키지 배포 가이드
description: Robota SDK 패키지를 npm에 배포하는 방법
lang: ko-KR
---

# 패키지 배포 가이드

이 가이드는 Robota SDK 패키지를 빌드하고 npm에 배포하는 방법을 설명합니다.

## 개요

Robota SDK는 다음과 같은 여러 패키지를 포함하는 모노레포 구조를 사용합니다:

- `@robota-sdk/core`: 핵심 기능
- `@robota-sdk/openai`: OpenAI 제공자
- `@robota-sdk/anthropic`: Anthropic 제공자
- `@robota-sdk/mcp`: Model Context Protocol 제공자
- `@robota-sdk/tools`: 유틸리티 도구

모든 패키지는 npm에서 `@robota-sdk` 스코프로 배포됩니다.

## 사전 요구사항

- Node.js 18 이상
- PNPM 8.0.0 이상
- `@robota-sdk` 조직에 접근 권한이 있는 npm 계정

## 배포 프로세스

배포 프로세스는 다음과 같은 주요 단계로 구성됩니다:

1. 패키지 빌드
2. docs 디렉토리에서 README 파일 복사
3. changesets를 사용하여 패키지 배포
4. git 태그 푸시
5. 임시 README 파일 정리

### 패키지 빌드

배포하기 전에 모든 패키지가 빌드되었는지 확인합니다:

```bash
pnpm build
```

### Changeset 생성

변경 사항을 설명하고 버전 범프를 지정하는 changeset을 생성합니다:

```bash
pnpm changeset
```

대화형 프롬프트에 따라 다음 단계를 진행합니다:
1. 포함할 패키지 선택
2. 버전 범프 유형 선택 (patch, minor, major)
3. 변경 사항 요약 작성

### 패키지 버전 업데이트

Changesets를 기반으로 패키지 버전을 업데이트합니다:

```bash
pnpm changeset version
```

이 명령은 다음과 같은 작업을 수행합니다:
1. package.json 버전 업데이트
2. 패키지 간 종속성 업데이트
3. CHANGELOG.md 파일 업데이트
4. 사용된 changeset 파일 제거

### 패키지 배포

단일 명령으로 배포 프로세스를 간소화했습니다:

```bash
pnpm publish-packages
```

이 명령은 다음 단계를 수행합니다:

1. docs 디렉토리에서 각 패키지 디렉토리로 README 파일 복사
2. changesets를 사용하여 npm에 패키지 배포
3. 원격 저장소에 git 태그 푸시
4. 임시 README 파일 정리

## README 관리

README 파일은 `apps/docs/docs/packages` 디렉토리에서 중앙 집중식으로 관리됩니다. 배포 과정에서:

1. README 파일이 패키지 디렉토리로 복사됩니다
2. README 파일이 포함된 패키지가 배포됩니다
3. 패키지 디렉토리에서 임시 README 파일이 제거됩니다

이 접근 방식은 문서와 npm 패키지 README 파일 간의 일관성을 보장합니다.

## 스크립트 구현

배포 프로세스는 두 가지 주요 스크립트로 구현됩니다:

### copy-readme.js

docs 디렉토리에서 패키지 디렉토리로 README 파일을 복사합니다.

### cleanup-readme.js

배포 후 패키지 디렉토리에서 임시 README 파일을 제거합니다.

## 문제 해결

### 인증 문제

npm 인증 문제가 발생하는 경우:

```bash
npm login --scope=@robota-sdk
```

### 배포 실패

배포가 실패하는 경우:

1. npm에서 적절한 권한이 있는지 확인합니다
2. 모든 changesets가 제대로 적용되었는지 확인합니다
3. git 작업 디렉토리가 깨끗한지 확인합니다

## 결론

이 표준화된 프로세스를 따르면 Robota SDK 에코시스템 전반에 걸쳐 일관된 패키지 배포 및 버전 관리를 보장할 수 있습니다. 