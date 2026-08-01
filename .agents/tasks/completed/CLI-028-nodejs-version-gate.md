---
title: 'CLI-028: Node.js 버전 체크 강화 — 명확한 오류 메시지 + 업그레이드 안내'
status: done
created: 2026-05-24
priority: high
urgency: now
area: packages/agent-cli
depends_on: []
---

## Background

`@robota-sdk/agent-cli`는 Ink 7.x 의존성으로 인해 Node.js 22+가 필요하다. 그러나 npm 생태계의 주류는 여전히 Node 20 LTS(LTS 종료: 2026-04-30)이고 많은 기업 CI 서버는 아직 Node 18/20을 사용한다.

현재 상황:

- Node 20 이하에서 실행 시 Ink 내부에서 알 수 없는 오류가 발생하거나 그냥 종료됨
- CLI-017이 done 처리됐으나 "Node 22 요구사항 문서화" 수준에서 끝난 것으로 보임
- 진입 장벽 제거 없이 실질적 해결이 아님

npx 첫 실행에서 "당신의 Node.js 버전이 너무 낮습니다"가 첫 메시지라면 이탈률이 매우 높다.

## 작업 항목

1. `bin.ts` 또는 `preflight.ts` 최상단에서 `process.version` 체크
2. Node < 22 감지 시 다음 형태의 명확한 오류 출력:

   ```
   ✗ Node.js 22 이상이 필요합니다 (현재: v20.11.0)

   업그레이드 방법:
     nvm:   nvm install 22 && nvm use 22
     Volta: volta install node@22
     직접:  https://nodejs.org/en/download
   ```

3. `package.json`의 `engines.node` 필드를 `">=22.0.0"`으로 명확히 설정
4. headless 모드(`-p`)에서도 동일한 체크 적용

## 탐색할 대안

- Ink 없이 headless 모드만 Node 18/20에서 동작하도록 분리 가능한지 검토 (구현 비용이 크면 skip)

## 성공 기준

- Node 20 환경에서 실행 시 알 수 없는 오류가 아닌 명확한 버전 오류 + 업그레이드 명령 출력
- 에러 exit code가 0이 아닌 1로 종료 (CI에서 감지 가능)
