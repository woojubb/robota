# ADR-001: I/T Prefix 유지 및 Type Alias 제한 정책

## Status
accepted

## Context

TypeScript 업계의 주류 방향은 interface에 `I*` prefix를 붙이지 않는 것이다 (Google TS Style Guide, Angular, TypeScript 컴파일러 팀 가이드라인). 이 프로젝트도 초기에 prefix-free 방식을 시도했으나 두 가지 실질적인 문제가 발생하여 `I*`/`T*` prefix를 도입했다.

### 문제 1: 클래스명과 타입명 충돌

prefix 없이 운영했을 때 `ConversationMessage`라는 이름이 type과 class 양쪽에 존재하게 되어 에이전트(AI 코딩 도구)가 기준 없이 하나를 선택하거나 이상한 예외처리를 만들어내는 일이 반복되었다. 사람이 작성할 때도 import 시 어느 것이 타입이고 어느 것이 구현인지 IDE hover 없이는 구분이 어려웠다.

업계의 충돌 회피 전략을 조사한 결과:

- **Google 방식 (역할 기반 이름 분리)**: interface에는 "왜 존재하는가"를 반영한 이름을 부여. `class TodoItem` + `interface TodoItemStorage`. 이론적으로 깔끔하지만, 모든 interface에 역할 이름을 고민해야 하는 인지 비용이 발생하고, 기존 수백 개 타입의 rename이 필요.
- **VS Code 방식 (I prefix 유지)**: TypeScript 컴파일러 팀의 자체 가이드라인과 다르게, 같은 Microsoft의 VS Code(150만 줄)는 `IModelService`, `IStaticExtension` 등 I prefix를 적극 사용. DI 기반 대규모 시스템에서 실용적으로 작동.
- **Fluent UI 경험**: v7에서 사용하던 I prefix를 v8에서 제거 시도. 마이그레이션 과정에서 *"Removing the prefix creates symbol collisions. Naming is hard, and removing the prefix makes things harder, so there is a need for strong guidance"*라는 결론에 도달.

### 문제 2: 의미 없는 type alias 남발로 SSOT 파괴

`type NewConversationMessage = ConversationMessage` 같은 1:1 alias가 여러 패키지에 생성되면서 같은 구조의 타입이 2개 이상 존재하게 되었다. 어느 것이 원본이고 어느 것이 복제인지 추적이 어려워지고, 한쪽을 수정해도 다른 쪽이 갱신되지 않는 유령 중복(phantom duplicate)이 발생했다.

조사 결과 `type X = Y` 형태의 trivial alias를 자동으로 감지하는 표준 ESLint 규칙은 존재하지 않는다 (`@typescript-eslint/no-type-alias`는 deprecated). 따라서 규칙으로 명시하고 코드 리뷰 + SSOT 스캔 도구(`ssot-scan-declarations.mjs`)로 방어해야 한다.

## Alternatives Considered

### 1. I/T prefix 제거 + 역할 기반 네이밍 (Google 방식)

- **장점**: 업계 주류 방향. 이름 자체가 의미를 전달.
- **단점**: 31개 workspace, 수백 개 기존 타입의 rename 필요. 모든 interface에 역할 이름을 고민하는 인지 비용. 에이전트(AI 도구)가 충돌 회피를 일관되게 수행하지 못한 실증 경험 있음.
- **판단**: 이론적 이상과 실용적 비용의 격차가 크다.

### 2. I/T prefix 유지 (현재 방식, VS Code 방식)

- **장점**: 클래스-타입 충돌 원천 차단. 기존 코드 변경 불필요. AI 에이전트가 기계적으로 적용 가능. 대규모 DI 시스템(VS Code)에서 검증된 패턴.
- **단점**: TypeScript 팀 가이드라인과 다름. 업계 다수 프로젝트 방향과 다름.
- **판단**: 이 프로젝트의 규모와 AI 에이전트 활용 특성상 실용적 이점이 이론적 단점을 상회.

### 3. prefix-free를 신규 코드에만 적용, 기존은 점진 마이그레이션

- **장점**: 전환 비용 분산.
- **단점**: 코드베이스 내 두 가지 스타일 공존으로 일관성 파괴. "이건 새 코드인가 기존 코드인가"를 매번 판단해야 함. Fluent UI가 이 경로에서 *"naming is hard, and removing the prefix makes things harder"*라는 결론에 도달.
- **판단**: 두 가지 규칙 공존은 하나의 규칙보다 나쁘다.

## Decision

### I/T prefix: 유지

`I*` prefix는 interface 전용, `T*` prefix는 type alias 전용으로 확정 유지한다. prefix-free 전환은 하지 않는다.

**선택 이유**:
1. 이 프로젝트에서 prefix-free 시 실제 충돌이 발생했던 실증 경험.
2. VS Code(150만 줄, DI 기반)가 같은 선택을 하고 있다는 대규모 검증 사례.
3. AI 에이전트가 prefix 기반으로 기계적/일관적으로 판단할 수 있다는 운영상 이점.
4. 31개 workspace의 기존 코드를 rename하는 비용 대비 이점 부재.

### Type alias: 생성 조건 제한

1. **다른 패키지의 타입을 사용할 때**: import하여 직접 사용하거나 `export type { X } from`으로 re-export. wrapper alias(`type MyX = X`) 금지.
2. **구조적으로 겹치는 새 타입 생성**: 원본을 public surface에 노출할 수 없을 때만 허용 (필드 축소, 내부 의존성 차단 등). 이름은 축소된 목적을 반영해야 한다.
3. **type alias의 용도**: union, intersection, mapped type, conditional type, tuple, primitive alias에만 사용. 객체 형태는 반드시 `interface`로 선언.
4. **trivial 1:1 alias 금지**: `type X = Y`는 의미적 확장이 없으므로 금지.

**선택 이유**:
1. SSOT 파괴의 근본 원인이 "alias를 만들어도 되는 조건"의 부재였음.
2. 자동 감지 ESLint 규칙이 존재하지 않으므로 규칙 명시 + 코드 리뷰 + SSOT 스캔으로 방어.
3. `export type { X } from`은 새 타입을 만들지 않으므로 SSOT를 보존하는 유일한 안전한 re-export 방법.

## Consequences

### 긍정적
- 클래스-타입 이름 충돌이 규칙 수준에서 원천 차단된다.
- type alias 남발로 인한 유령 중복이 방지된다.
- AI 에이전트가 `I*`/`T*` prefix를 기계적으로 적용하여 일관성을 유지할 수 있다.
- `ssot-scan-declarations.mjs`로 위반을 기계적으로 감지할 수 있다.

### 부정적
- TypeScript 업계 주류 방향(prefix-free)과 다르다. 외부 기여자가 "왜 I prefix를 쓰나요?"라고 물을 수 있다 → 이 ADR을 참조.
- 객체 형태를 type alias로 선언할 수 없으므로 intersection으로 객체를 조합하는 패턴에 제약이 생길 수 있다 → union/intersection 결과가 객체더라도 type alias로 선언 가능 (규칙은 "순수 객체 리터럴 형태"에만 적용).

### 후속 작업
- 없음. 기존 코드가 이미 이 규칙을 따르고 있다.

## References
- [Google TypeScript Style Guide — Naming](https://google.github.io/styleguide/tsguide.html)
- [Microsoft TypeScript Coding Guidelines](https://github.com/microsoft/TypeScript/wiki/Coding-guidelines) — "Do not use I as a prefix for interface names" (팀 내부 규칙이며 커뮤니티 규범 아님을 명시)
- [VS Code Coding Guidelines](https://github.com/microsoft/vscode/wiki/Coding-Guidelines) — I prefix 적극 사용
- [Fluent UI Issue #10266 — Remove I-prefix RFC](https://github.com/microsoft/fluentui/issues/10266) — "Removing the prefix creates symbol collisions"
- `AGENTS.md` > Type System (Strict)
- `.agents/skills/type-boundary-and-ssot/SKILL.md`
