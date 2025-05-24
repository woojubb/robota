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

### 아키텍처 패턴

#### 매니저 패턴
- 기능별로 매니저 클래스를 구성하여 단일 책임 원칙 준수
- 각 매니저는 특정 도메인의 상태와 동작을 관리
- 예: `AIProviderManager`, `ToolProviderManager`, `SystemMessageManager`

#### 서비스 레이어
- 비즈니스 로직은 서비스 클래스로 분리
- 매니저들을 조합하여 복잡한 비즈니스 프로세스 처리
- 예: `ConversationService`

#### 의존성 주입과 위임
- 메인 클래스는 의존성 주입을 통해 매니저들을 구성
- 공개 API는 적절한 매니저에게 위임하여 구현

## 빌드 시스템 규칙

### 테스트 파일 분리

- **프로덕션 빌드**: 테스트 파일은 프로덕션 빌드에서 제외되어야 함
- **TypeScript 설정**: `tsconfig.json`에서 테스트 파일을 `exclude`에 포함
- **테스트용 설정**: 별도의 `tsconfig.test.json`을 사용하여 테스트 실행 시에만 테스트 파일 포함

```json
// tsconfig.json - 프로덕션 빌드용
{
  "exclude": [
    "src/**/*.test.ts",
    "src/**/*.test.tsx", 
    "src/**/*.spec.ts",
    "src/**/*.spec.tsx"
  ]
}

// tsconfig.test.json - 테스트용
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*"],
  "exclude": []
}
```

### 타입 시스템 관리

- **타입 위치**: 타입은 가장 적절한 위치에 정의하여 순환 의존성 방지
- **타입 재사용**: 공통 타입은 적절한 모듈에서 export하여 재사용
- **명명 충돌 방지**: `.d.ts`와 `.ts` 파일 간 명명 충돌 주의

### 빌드 도구 설정

- **vitest 설정**: 테스트용 TypeScript 설정 파일 지정
- **빌드 캐시**: 빌드 문제 발생 시 캐시 정리 후 재시도
- **타입 체크**: `tsc --noEmit`으로 타입 오류 사전 검증

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

### 리팩토링된 구조 테스트

- **매니저 기반 테스트**: 리팩토링된 매니저 구조에 맞게 테스트 작성
- **Mock Provider 구현**: 새로운 인터페이스에 맞는 Mock Provider 작성
- **내부 속성 접근**: 매니저를 통한 내부 상태 검증

```typescript
// ✅ 매니저 기반 테스트 예시
it('함수 호출 설정으로 초기화되어야 함', () => {
    expect(customRobota['functionCallManager'].getDefaultMode()).toBe('auto');
    expect(customRobota['functionCallManager'].getMaxCalls()).toBe(5);
});

// ✅ 새로운 구조에 맞는 Mock Provider
class MockProvider implements AIProvider {
    public name = 'mock';
    public availableModels = ['mock-model'];
    
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        // Mock 구현
    }
}
```

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