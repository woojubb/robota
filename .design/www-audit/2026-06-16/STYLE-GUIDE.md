# apps/www 카피 스타일 가이드

WEB-010 산출물. 마케팅 사이트(`apps/www`) 카피 작성 시 따르는 규칙. 세부 근거는
[05-global-consistency.md](05-global-consistency.md) 참조.

## 보이스

- 차분하고 정밀한 **엔지니어 톤**(engineer-to-engineer). 대상은 전문 TypeScript 개발자.
- 과장 형용사·마케팅 클리셰·경쟁사 가격 저격 금지.
- 단정형 사실 진술. 검증 불가한 절대어("the only", "no other", "never", "fully") 금지 —
  꼭 써야 하면 조건을 명시한다(예: "로컬 모델을 사용하면 …").

## 고정 용어

| 개념            | 표준 (EN / KO)                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 제품 한 줄 정의 | **AI agent SDK and CLI / AI 에이전트 SDK 및 CLI** (페이지마다 바꾸지 않는다)                                               |
| 런타임 핵심     | **agent runtime / 에이전트 런타임** ("engine/엔진"·"framework" 혼용 금지). 패키지명 `@robota-sdk/agent-framework`는 그대로 |
| BYOK            | 첫 등장 시 **bring your own key (BYOK) / 본인 키 사용(BYOK)** 풀이 후 약어                                                 |
| 임베드          | **embeddable SDK / 임베드 가능한 SDK**                                                                                     |
| provider        | **provider / 프로바이더**                                                                                                  |

## 라이선스 표기 (WEB-006 SSOT)

- 라이선스는 **혜택이 아니라 중립적 사실**. "이래서 좋다"가 아니라 "이렇게 라이선스된다".
- 표준 문구: `Open source (AGPL-3.0). A commercial license is available.` /
  `오픈소스 (AGPL-3.0). 상업용 라이선스 별도 제공.`
- 노출은 footer 1회 + enterprise FAQ(상세) + compare 비교표 행 1회로 제한. 저작권 줄·히어로·기능
  카드 제목에는 라이선스명을 넣지 않는다.

## 표기 규칙

- 워드마크: chrome에서 소문자 `robota`, 본문에서는 항상 `Robota`.
- "commercial"은 문장 내에서 소문자, 제목 케이스 헤딩에서만 `Commercial`.
- 외부 링크는 `↗`, 인라인 CTA는 `→`.
- 한국어는 직역투 금지(예: "런타임 놀라움 없음" → "예기치 않은 런타임 동작 없음").
- 날짜·분기 하드코딩 지양. 못 박은 분기/절대 날짜는 곧 stale가 되어 약속처럼 읽힌다.

## 아이콘 (후속: WEB-012)

- 기능 카드의 컬러 이모지(🔑🔄📦🏠🔓⚡)는 개발자 대상에서 유치하게 읽힌다. 일관된 단색 라인
  아이콘 세트로 교체하거나 제거 — 디자인 결정 필요(WEB-012에서 처리).
