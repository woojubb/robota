# Playground Provider Replacement (개요)

> Playground에서 사용할 Provider를 RemoteExecutor 기반으로 교체하는 전략 요약입니다. 세부 작업은 `CURRENT-TASKS.md` Priority 3과 `.design/open-tasks/REMOTE-SYSTEM.md`를 참고하세요.

## 배경
- 기존 Playground는 각 Provider SDK(OpenAI, Anthropic, Google)를 직접 호출하며 API Key를 브라우저에 저장
- Provider별로 응답 포맷이 달라 후처리 코드가 중복

## 전환 전략
1. 모든 Playground Provider 구현을 RemoteExecutor 프록시로 대체 (`executor` 옵션 필수)
2. 모델/키 등 민감 정보는 Remote Server에서만 보관, Playground는 user session token만 사용
3. Provider별 차이는 Remote Server에서 Normalized Response 형태로 맞춘다 (UnifiedMessage)
4. 에러/사용량 로깅을 Remote Server 미들웨어에서 일원화

## 효과
- 브라우저에 API Key 저장 금지, 보안 강화
- Provider 교체 시 Remote Server만 업데이트하면 Playground가 자동 반영
- Playground UI는 통일된 응답 구조로 렌더링 가능

---

추가 세부사항은 Remote System 문서 및 CURRENT-TASKS를 참고하세요.
