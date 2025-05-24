# 기여 가이드라인

Robota 프로젝트에 기여해 주셔서 감사합니다! 이 문서는 프로젝트에 기여하는 방법에 대한 지침을 제공합니다.

## 개발 환경 설정

1. 저장소 클론:

```bash
git clone https://github.com/woojubb/robota.git
cd robota
```

2. 의존성 설치:

```bash
pnpm install
```

3. 개발 서버 실행:

```bash
pnpm dev
```

## 프로젝트 구조

Robota는 모노레포 구조로 설계되었으며, 다음과 같은 패키지로 구성되어 있습니다:

- `packages/core`: 핵심 모듈과 공통 인터페이스
- `packages/openai`: OpenAI 통합
- `packages/anthropic`: Anthropic 통합
- `packages/mcp`: MCP(Model Context Protocol) 통합
- `packages/tools`: 도구 및 유틸리티
- `apps/docs`: 문서 웹사이트
- `apps/examples`: 예제 코드

## 새 기능 개발

1. 새 브랜치 생성:

```bash
git checkout -b feature/your-feature-name
```

2. 코드 작성 및 테스트:

```bash
pnpm test
```

3. 커밋 및 푸시:

```bash
git add .
git commit -m "feat: 설명"
git push origin feature/your-feature-name
```

4. Pull Request 제출

## 커밋 메시지 컨벤션

커밋 메시지는 다음 형식을 따릅니다:

- `feat`: 새 기능 추가
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 코드 포맷팅, 세미콜론 누락 등 (코드 변경 없음)
- `refactor`: 코드 리팩토링
- `test`: 테스트 관련 코드
- `chore`: 빌드 프로세스 또는 보조 도구 변경

예: `feat: OpenAI 제공업체에 gpt-4o 모델 지원 추가`

## Pull Request 가이드라인

1. 명확한 제목과 설명
2. 관련 이슈 연결
3. 변경 사항에 대한 테스트 포함
4. 문서 업데이트 (필요시)

## 코드 스타일

- 프로젝트는 ESLint와 Prettier를 사용합니다.
- 커밋 전 코드 스타일 확인:

```bash
pnpm lint
pnpm format
```

## 라이선스

모든 기여는 프로젝트의 MIT 라이선스 하에 제공됩니다. 