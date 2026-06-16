# 엔터프라이즈 페이지 검토 (apps/www enterprise)

검토 대상:

- 컴포넌트: `apps/www/src/app/[locale]/enterprise/page.tsx`
- 카피: `apps/www/src/messages/en.json` / `apps/www/src/messages/ko.json` 의 `enterprise` 키

검토자 관점: 출시 전 최종 카피 리뷰 (PM). 이 페이지는 엔터프라이즈 구매자에게 **보안·컴플라이언스 클레임**을 직접 제시하므로 정확성이 최우선 기준이다.

---

## 요약

전반적으로 데이터 처리 표·온프레미스·텔레메트리 없음 등 **기술적으로 사실인 강점**은 잘 정리되어 있고, 이 페이지의 핵심 자산이다. 그러나 출시 즉시 신뢰도를 훼손할 수 있는 **3개의 치명적(P0) 클레임**이 있다:

1. **"30 영업일 이내 응답"** — 엔터프라이즈 세일즈 기준 약 6주는 비상식적으로 느리며, 강점이 아니라 약점으로 읽힌다. 사실상 자해성 문구.
2. **"SOC 2 / ISO 27001 호환"** — 제품 자체가 보유하지 않은 인증을 "호환"이라는 표현으로 암시한다. 엔터프라이즈 조달·법무 검토에서 허위·오해 소지로 가장 먼저 걸리는 문구.
3. **"AGPL-3.0 및 상업용"을 보안 하이라이트로 배치** — 라이선스는 보안 기능이 아니다. 또한 "확인 후 14일 이내 패치 발행을 목표"라는 문구는 공개 가능한 SLA 약속처럼 읽혀 위험하다.

추가로 **EN↔KO 렌더링 버그**가 1건 있다: KO에만 존재하는 `contact.responseTimeSuffix` 키("이내에 응답합니다.")가 TSX에서 렌더링되지 않아, 한국어 페이지에서는 "모든 엔터프라이즈 문의에는 **30 영업일**." 로 문장이 잘려서 비문이 된다.

톤은 대체로 차분하나, "호환"·"목표로 합니다" 등 모호하게 약속을 암시하는 표현이 엔터프라이즈 카피의 정밀함 기준에 미달한다.

---

## 신뢰도 훼손 / 허위·과장 클레임 (PRIMARY)

### 1. "30 business days / 30 영업일 이내 응답" — **P0, 자해성 문구**

- 위치: `contact.responseTime` + `contact.responseTimeHighlight`
- 현재(EN): "We respond to all enterprise inquiries within **30 business days**."
- 현재(KO): "모든 엔터프라이즈 문의에는 **30 영업일** [이내에 응답합니다.]"
- **문제:**
  - 30 영업일 = 캘린더 기준 약 6주. 엔터프라이즈 인바운드 리드에 6주 후 응답하겠다는 약속은 리드가 이미 경쟁사로 넘어간 시점이다. 구매자가 보기에 "이 회사는 엔터프라이즈 세일즈를 진지하게 하지 않는다"는 신호로 읽힌다.
  - "응답 시간"을 자랑처럼 강조(`<strong>` 처리)해 놓고 6주를 제시하는 것은 자기모순이다. 차라리 명시하지 않는 편이 낫다.
- **권장:** 오픈소스 프로젝트로서 정직하게 "베스트 에포트"임을 인정하되, 현실적이고 신뢰 가는 수치로 교체. 2영업일이 부담되면 "3 business days" 또는 SLA 약속을 피하는 표현("typically within ~~"). 정량 약속이 부담이면 채널별 안내로 전환.
- **제안(EN):** "We aim to respond to enterprise inquiries within **2 business days**." (또는 "We typically reply to enterprise inquiries within a couple of business days.")
- **제안(KO):** "엔터프라이즈 문의에는 영업일 기준 **2일 이내** 회신을 목표로 합니다." (또는 "엔터프라이즈 문의에는 보통 영업일 며칠 내로 회신드립니다.")

### 2. "SOC 2 / ISO 27001 호환 — 호환되는 AI 프로바이더와 함께 사용 시" — **P0, 오해 소지 / 컴플라이언스 리스크**

- 위치: `security.highlights[3]`
- 현재(EN): "SOC 2 / ISO 27001 compatible" / "When combined with a compliant AI provider"
- 현재(KO): "SOC 2 / ISO 27001 호환" / "호환되는 AI 프로바이더와 함께 사용 시"
- **문제:**
  - Robota 자체는 어떤 인증도 보유하지 않는다. "호환(compatible)"이라는 단어는 보안/조달 검토자에게 "인증을 충족한다"는 인상을 줄 수 있어, 인증 미보유 사실이 드러나면 페이지 전체의 신뢰가 무너진다. 이것이 엔터프라이즈 검토에서 가장 위험한 종류의 문구다.
  - 인증은 조직·운영에 부여되는 것이지 라이브러리에 "호환"이라는 속성으로 붙는 개념이 아니다. 표현 자체가 기술적으로 부정확하다.
- **권장:** 인증 클레임을 제거하고, **사실인 강점**으로 재구성한다. 즉 "Robota는 데이터를 보관하지 않으므로, 귀사가 이미 인증된 프로바이더/인프라를 쓰면 컴플라이언스 경계가 귀사 통제 하에 유지된다"는 정확한 포지셔닝.
- **제안(EN):** title "Stays inside your compliance boundary" / body "Robota stores no data of its own, so your existing controls and your provider's certifications (e.g. SOC 2, ISO 27001) remain the system of record."
- **제안(KO):** title "귀사 컴플라이언스 경계 내 동작" / body "Robota는 자체적으로 어떤 데이터도 보관하지 않으므로, 귀사의 기존 통제와 프로바이더 인증(예: SOC 2, ISO 27001)이 그대로 기준점으로 유지됩니다."

### 3. "확인 후 14일 이내 패치 발행을 목표로 합니다" — **P1, 공개 SLA로 읽힘**

- 위치: `vulnerabilityDisclosure.patchDays` + `patchDaysSuffix`
- 현재(EN): "We follow responsible disclosure and aim to issue a patch within **14 days** of confirmation."
- 현재(KO): "책임 있는 공개 정책을 따르며 확인 후 **14일** 이내에 패치를 발행하는 것을 목표로 합니다."
- **문제:** 심각도와 무관하게 모든 취약점에 14일 패치를 "목표"로 명시하는 것은 공개된 약속으로 읽힌다. 소규모 OSS 프로젝트가 지키지 못할 경우 오히려 비난 근거가 된다. "목표(aim)"라는 완화어가 있어도 정량 수치는 SLA처럼 인용된다.
- **권장:** 심각도 기반 + 정량 약속 제거. "심각도에 따라 합리적인 기간 내 대응" 수준으로 완화.
- **제안(EN):** "We follow responsible disclosure and prioritize fixes based on severity, working to ship a patch as quickly as is practical."
- **제안(KO):** "책임 있는 공개 정책에 따라 심각도를 기준으로 우선순위를 정하며, 가능한 한 신속히 패치를 제공하기 위해 노력합니다."

### 4. 데이터 처리 표 / 온프레미스 클레임 정확성 — **대체로 정확, 경미한 보강만**

- 표 자체는 정확하다(프롬프트→설정한 프로바이더만 전송, API 키→로컬, 세션→로컬 파일시스템, 도구 출력→로컬). 이 페이지의 가장 신뢰 가는 부분이며 유지 권장.
- "fully air-gapped / 완전한 에어갭 배포 지원" (`security.onPremises.description`)은 **P2 주의**: 로컬 LLM 사용 시 추론 호출은 에어갭 가능하나, npm 설치/업데이트 경로는 인터넷 또는 내부 미러가 필요하다(FAQ에서 스스로 그렇게 안내함). "supports air-gapped operation" 정도로 한정 권장 — "fully"는 과장.
- **제안(EN):** "Robota can run in air-gapped environments with local LLMs (install packages from an internal mirror):"
- **제안(KO):** "Robota는 로컬 LLM과 함께 에어갭 환경에서 동작할 수 있습니다 (패키지는 내부 미러에서 설치):"

---

## 발견 사항

| 심각도            | 위치 (file:key)                                                     | 현재 문구                                                                                                                                      | 문제                                                                                                                               | 제안 수정안 (EN / KO)                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0**            | `en/ko.json: enterprise.contact.responseTimeHighlight`              | "30 business days" / "30 영업일"                                                                                                               | 엔터프라이즈 세일즈에 약 6주 응답은 비상식적으로 느림. 강조해 놓아 자해성                                                          | "2 business days" / "영업일 기준 2일 이내"                                                                                                                                                                                                                                                                                                                               |
| **P0**            | `en/ko.json: enterprise.security.highlights[3]`                     | "SOC 2 / ISO 27001 compatible — When combined with a compliant AI provider" / "SOC 2 / ISO 27001 호환 — 호환되는 AI 프로바이더와 함께 사용 시" | 미보유 인증을 "호환"으로 암시. 조달·법무 검토에서 허위·오해 소지                                                                   | "Stays inside your compliance boundary / Robota stores no data of its own, so your existing controls and your provider's certifications (e.g. SOC 2, ISO 27001) remain the system of record." / "귀사 컴플라이언스 경계 내 동작 / Robota는 자체적으로 데이터를 보관하지 않으므로 귀사 기존 통제와 프로바이더 인증(예: SOC 2, ISO 27001)이 그대로 기준점으로 유지됩니다." |
| **P0(렌더 버그)** | `ko.json: enterprise.contact.responseTimeSuffix` + `page.tsx:32-36` | KO에 `responseTimeSuffix`("이내에 응답합니다.") 키 존재하나 TSX는 `responseTime`+`highlight`+하드코딩 `'.'`만 렌더                             | 한국어 페이지가 "...에는 30 영업일." 로 잘려 비문. EN 구조에는 해당 키 자체가 없음(불일치)                                         | 문구를 P0(#1)대로 교체하면서, KO는 highlight에 동사구 포함시켜 suffix 의존 제거(예: highlight "2영업일 이내", 본문 "엔터프라이즈 문의에는 영업일 기준 2일 이내 회신을 목표로 합니다.") / EN·KO 키 구조 일치시킬 것                                                                                                                                                       |
| **P1**            | `en/ko.json: enterprise.vulnerabilityDisclosure.patchDays(+Suffix)` | "aim to issue a patch within 14 days of confirmation" / "확인 후 14일 이내에 패치를 발행하는 것을 목표로 합니다"                               | 정량 패치 기한이 공개 SLA로 인용됨. 미준수 시 비난 근거                                                                            | "We follow responsible disclosure and prioritize fixes based on severity, shipping a patch as quickly as is practical." / "책임 있는 공개 정책에 따라 심각도 기준으로 우선순위를 정하며 가능한 한 신속히 패치를 제공하도록 노력합니다."                                                                                                                                  |
| **P1**            | `en/ko.json: enterprise.security.highlights[0]`                     | "AGPL-3.0 & Commercial / Full source code available for audit..." / "AGPL-3.0 및 상업용 / ...감사를 위한 전체 소스 코드 제공"                  | 라이선스는 보안 기능이 아님. 보안 하이라이트 카드에 라이선스명을 제목으로 두면 범주 오류                                           | title을 보안 사실로 교체: "Auditable source code / Full source is public on GitHub for security review (github.com/woojubb/robota)." / "감사 가능한 소스 코드 / 전체 소스가 GitHub에 공개되어 보안 검토가 가능합니다." (라이선스 설명은 FAQ의 라이선스 항목으로 이동)                                                                                                    |
| **P2**            | `en/ko.json: enterprise.security.onPremises.description`            | "fully air-gapped deployments" / "완전한 에어갭 배포"                                                                                          | npm 설치 경로는 인터넷/내부 미러 필요 — "fully"는 과장 (FAQ와 모순)                                                                | "can run in air-gapped environments with local LLMs (install packages from an internal mirror)" / "로컬 LLM과 함께 에어갭 환경에서 동작 가능 (패키지는 내부 미러에서 설치)"                                                                                                                                                                                              |
| **P2**            | `page.tsx:33-36`                                                    | `{t('contact.responseTime')}` + highlight + 하드코딩 `'.'`                                                                                     | 문장 종결부를 TSX에 하드코딩해 i18n 우회. 언어별 어순 차이를 수용 못함(위 KO 버그의 근본 원인)                                     | 종결부를 메시지 키로 빼서 EN·KO 모두 동일 패턴으로 렌더                                                                                                                                                                                                                                                                                                                  |
| **P2**            | `page.tsx:111-113` 코드 예시                                        | `import { OpenAIProvider } from '@robota-sdk/openai'` (온프레미스 섹션)                                                                        | 온프레미스/로컬 LLM 맥락인데 import 이름이 "OpenAI"라 혼동 가능(실제로는 OpenAI-호환 엔드포인트용). 사실 오류는 아니나 메시지 약화 | 주석 1줄 추가 권장: "// OpenAI-compatible client pointed at your internal endpoint" / 해당 한국어 주석                                                                                                                                                                                                                                                                   |

---

## AGPL / 라이선스 표현 문제

- **보안 하이라이트에 라이선스를 배치한 것이 핵심 문제(P1).** `security.highlights[0]`의 제목이 "AGPL-3.0 & Commercial"인데, 이는 보안 속성이 아니다. 엔터프라이즈 보안 검토자가 보안 카드 그리드에서 라이선스명을 보면 카테고리 혼란을 느낀다. 실제로 보안에 기여하는 사실은 "소스가 공개되어 감사 가능하다"는 점이므로 제목을 그 사실로 바꾸고, AGPL/상업용 듀얼 라이선스 설명은 이미 잘 작성된 FAQ의 "상업적 라이선스 옵션" 항목에 맡기는 것이 맞다.
- **AGPL을 "혜택(benefit)"으로 프레이밍하는 부분은 페이지 내에서 과하지 않다.** FAQ 라이선스 항목은 "AGPL-3.0 의무를 충족할 수 없는 독점/비공개 용도를 위한 상업용 라이선스"라고 **중립적·정확하게** 서술하고 있어 양호하다(유지 권장). 이 항목은 좋은 모범이다.
- 권장 정리: 보안 카드에서 라이선스 제거 → "감사 가능한 소스 코드"로 대체. 라이선스는 FAQ 한 곳에서만 다룬다(SSOT 원칙과도 부합).

---

## EN↔KO 정합성 이슈

1. **(P0, 구조 불일치 + 렌더 버그)** `contact` 객체의 키 구조가 EN/KO 간 다르다.
   - EN: `responseTime`, `responseTimeHighlight` (suffix 없음 — `.`만 TSX 하드코딩)
   - KO: `responseTime`, `responseTimeHighlight`, **`responseTimeSuffix`** (추가 키)
   - TSX는 suffix를 렌더하지 않으므로 KO 페이지에서 "이내에 응답합니다" 문장이 사라지고 "...에는 30 영업일." 비문이 출력된다. EN은 영어 어순상 우연히 자연스럽게 끝나지만 KO는 깨진다. → 키 구조를 양 언어 동일하게 맞추고, 문장 종결부를 메시지 키로 통일해야 함.
2. **(P2)** `tableHeaders[1]`: EN "Where it goes" vs KO "저장 위치". EN은 "어디로 가는가(전송/보관 모두 포함)"의 뉘앙스인데 KO "저장 위치"는 전송 데이터(프롬프트→프로바이더 전송)를 "저장"으로 좁혀 부정확. → KO "데이터의 행선지" 또는 "처리/전송 위치" 권장.
3. **(P2)** `security.highlights[1]` body: EN "No analytics, no phone-home" vs KO "분석 기능, 외부 전송 기능 없음". "phone-home"의 의도(자동 외부 보고)는 "외부 전송"보다 "자동 신고/콜백 없음"이 더 정확. 의미 통하므로 경미. KO "분석 기능도, 자동 외부 보고(phone-home)도 없음" 권장.
4. **(P2)** 용어 일관성: KO 전반에서 "프로바이더", "온프레미스", "에어갭" 등 음차 표기는 개발자 대상이라 허용 범위. 단 description의 "AI 코딩 어시스턴트"는 자연스러움. 전반적으로 한국어는 번역투가 심하지 않고 양호한 편(FAQ 특히 자연스러움).
5. **(정합, 양호)** 이메일·연락처는 EN/KO/TSX 전반에서 `enterprise@robota.io`, `security@robota.io`로 일관됨. GitHub Discussions 링크도 일치. 문제 없음.

---

## 부가 메모 (구현 정정)

- 위 P0 #1·#2를 반영하면 `security.highlights` 배열이 4개에서 유지되되 0번·3번 항목 텍스트가 바뀐다. P1 라이선스 항목 이동 시 카드 개수가 3개로 줄 수 있으니, `sm:grid-cols-2` 레이아웃에서 홀수 카드가 어색하지 않은지 디자인 확인 필요(빈 칸 발생 가능).
- 소스 파일은 수정하지 않았다(검토 전용). 위 제안은 카피 교체안이며, 실제 반영 시 `responseTimeSuffix` 키 구조 통일 작업이 동반되어야 한다.
