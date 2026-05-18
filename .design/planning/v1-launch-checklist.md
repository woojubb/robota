# v1.0.0 Launch Checklist

목표: "beta" 라벨 제거 및 v1.0.0 공식 선언. 기업 채택 심리 장벽 제거.

## 기술 완성 기준

### Critical Bug 전부 해결

- [ ] SEC-001: WebSocket JWT 토큰 검증
- [ ] SEC-002: API 키 시크릿 관리 정책
- [ ] CLI2-001: --help 플래그 지원
- [ ] CLI2-006: --output-format 유효성 검사
- [ ] DEV-002: WebSocket non-null assertion
- [ ] DEV-003: require.main === module ESM misuse
- [ ] PLG-001: Playground WebSocket URL 하드코딩

### High Priority 해결

- [ ] HOOK-002~007: Claude Code 훅 호환성
- [ ] SRV-001~002: 서버 안정성 (Graceful Shutdown, 메모리 누수)
- [ ] CLI2-002~005: CLI 동작 결함들

### 기능 완성도

- [ ] Session replay: `robota -r <session-id>` 신뢰성 있게 동작
- [ ] Session fork: `robota -c --fork-session` 정상 동작
- [ ] Subagent: `/agent` 명령 end-to-end 동작

## 문서 완성 기준

- [ ] 3개 레이어 동기화: SPEC.md + package README + content/ 일치
- [ ] Getting Started: 5분 안에 첫 CLI 실행 가능한 흐름
- [ ] API Reference: 모든 public export에 JSDoc
- [ ] CHANGELOG.md 작성 (beta → v1.0.0 변경사항 요약)
- [ ] Migration guide (beta.\* → v1.0.0): breaking changes 목록

## 마케팅/커뮤니티 준비

- [ ] GitHub Discussions 활성화
- [ ] CONTRIBUTING.md 작성 ✅ (2026-05-18)
- [ ] good first issue 라벨 이슈 10개 이상
- [ ] v1.0.0 런치 블로그 포스트 사전 작성
- [ ] Product Hunt 등록 준비

## 품질 게이트

```bash
pnpm typecheck        # zero errors
pnpm lint             # zero warnings
pnpm test             # all pass
pnpm harness:scan     # all checks pass
pnpm build            # all packages build clean
```

## 배포 절차

```bash
# 1. 버전 범프
pnpm version:bump 1.0.0

# 2. 최종 검증
pnpm harness:verify:release

# 3. 배포
pnpm publish:beta  # dist-tag latest + beta 동시 설정
```

---

_현재 버전: v3.0.0-beta.67 (2026-05-18 기준)_
