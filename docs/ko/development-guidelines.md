# 개발 가이드라인

이 문서는 Robota 프로젝트 개발 시 따라야 할 가이드라인을 제공합니다.

## 코드 구성 원칙

### 모듈 분리

- 각 기능은 명확히 분리된 모듈로 구현
- 모듈 간 의존성은 최소화하고 명시적으로 관리
- 코어 모듈은 특정 구현체에 의존하지 않아야 함

### 인터페이스 설계

- 명확한 인터페이스 정의
- 확장 가능성을 고려한 설계
- 일관된 네이밍 컨벤션 적용

## 런타임 및 실행 환경

### TypeScript 실행

- **bun 사용**: TypeScript 코드 실행 시 ts-node 대신 bun을 사용
- **예시**: `bun run script.ts` 형식으로 스크립트 실행
- 성능 및 일관성을 위해 프로젝트 전체에서 동일한 런타임 사용

### 개발 환경 설정

- bun을 사용하여 개발 의존성 관리
- 스크립트 실행 및 테스트에 bun 사용
- 프로덕션 빌드에도 bun 사용 권장

## Mock 및 테스트 데이터 사용 규칙

### 기본 원칙

- **실제 구현 우선**: 코드베이스 전체에서 Mock이나 더미 데이터 대신 실제 구현을 지향
- **테스트 코드에서만 Mock 사용**: Mock 객체와 더미 데이터는 오직 자동화된 테스트 코드에서만 사용
- **예제 코드는 실제 구현 사용**: 예제 코드는 실제 사용자가 사용할 방식과 동일하게 실제 구현을 활용

### Mock 구현 제한

- `/tests` 디렉토리: 테스트를 위한 Mock 구현 배치 - 테스트 실행 시에만 사용
- `/src` 디렉토리 및 `/examples` 디렉토리에는 Mock 구현이나 더미 데이터를 포함하지 않음
- 예제 코드는 간소화된 실제 구현을 사용하여 실제 상황과 유사한 환경 제공

### Mock 사용이 허용되는 경우

- 자동화된 테스트(단위 테스트, 통합 테스트)를 실행할 때
- 외부 API에 의존하는 테스트를 진행할 때(이 경우도 가능하면 실제 테스트 API 키 사용)
- CI/CD 파이프라인에서 테스트를 실행할 때

### 예시

```typescript
// ✅ 좋은 예: 실제 구현 사용
// /examples/mcp/mcp-example.ts
import { Client } from '@modelcontextprotocol/sdk';

const client = new Client(transport);
const result = await client.run(context);

// ❌ 나쁜 예: 예제에서 Mock 사용
// /examples/mcp/mcp-example.ts
import MockMCPClient from './__mocks__/mcp-client.mock';

const mockClient = new MockMCPClient();
const result = await mockClient.run(context);
```

## 테스트 규칙

### 테스트 범위

- 모든 공개 API에 대한 단위 테스트 필수
- 중요 기능에 대한 통합 테스트 권장
- Edge case 및 오류 처리에 대한 테스트 포함

### 테스트 구성

- 파일별 테스트 작성
- 관련 테스트는 논리적으로 그룹화
- 테스트는 독립적으로 실행 가능해야 함

## 문서화 규칙

### 코드 문서화

- 모든 공개 API에 JSDoc 주석 포함
- 복잡한 알고리즘이나 비즈니스 로직에 인라인 주석 추가
- 예제 코드 제공

### 외부 문서

- 새로운 기능은 해당 문서 업데이트
- API 변경사항은 문서에 반영
- 중요한 변경사항은 CHANGELOG.md 업데이트

## 성능 고려사항

- 성능에 민감한 코드 경로 식별 및 최적화
- 불필요한 API 호출 최소화
- 메모리 사용량 모니터링 및 최적화

## 보안 고려사항

- 사용자 입력 검증
- API 키와 같은 민감한 정보 보호
- 의존성 정기적 업데이트

## 접근성 고려사항

- 명확한 오류 메시지
- 로깅 및 디버깅 지원
- 다양한 사용자 시나리오 지원

## 콘솔 출력 및 로깅 규칙

- **console.log 직접 사용 금지**: `./packages/` 내의 모든 TypeScript(.ts) 파일에서는 `console.log`를 직접 호출할 수 없습니다.
- **logger 유틸리티 사용**: 로그가 필요한 경우 반드시 제공되는 `logger` 유틸리티(`info`, `warn`, `error` 메서드)를 사용해야 합니다.
- **예외 경로**: `./apps/examples/` 및 `./scripts/` 경로 내의 코드에서는 `console.log` 사용이 허용됩니다.
- **문서화 및 예제**: 위 규칙을 위반하는 코드는 PR 리뷰 시 반드시 수정되어야 하며, 예제 및 스크립트 외의 모든 로그는 logger를 통해 출력되어야 합니다.
- **logger 예시**:

```typescript
import { logger } from '@robota-sdk/core/src/utils';
logger.info('정보 메시지');
logger.warn('경고 메시지');
logger.error('에러 메시지');
``` 