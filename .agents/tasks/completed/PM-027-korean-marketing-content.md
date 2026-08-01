---
title: 'PM-027: 한국어 마케팅 콘텐츠 — GeekNews, okky, velog 타겟'
status: superseded
completed: 2026-07-25
created: 2026-05-24
priority: medium
urgency: soon
area: apps/www, apps/docs
depends_on: []
---

> **Superseded.** The only agent-executable slice shipped: the Korean README
> (`packages/agent-cli/docs/README-KO.md`, PR #589, 2026-05-25). The remaining scope
> (GeekNews/velog/okky posts, community Q&A cadence) is manual owner-run community action that was
> never performed, and community/blog launch content is owned by MKT-001 (done 2026-05-18,
> `apps/blog` + GitHub community). Do not stamp done — no community posting evidence exists.
> Reconciled 2026-07-25 (PROC-001).

## Background

Robota는 한국 팀이 만든 AI SDK/CLI다. 한국 개발자 커뮤니티(GeekNews, okky, velog, disquiet)에서 "한국산 오픈소스 Claude Code 대안"으로 포지셔닝하면 초기 사용자 획득 비용이 거의 없다. 영어 마케팅보다 한국어 콘텐츠가 신뢰도와 공감을 2배 이상 높인다.

현재 상황:

- robota.io에 한국어 랜딩 페이지 있음 (SITE-006 완료)
- 하지만 소셜/커뮤니티 채널에 한국어 콘텐츠가 없음
- GeekNews에 한번도 올라간 적 없음

## 작업 항목

### 콘텐츠 제작

1. **GeekNews 포스트 (영문 링크 + 한국어 설명)**
   - 제목: "TypeScript로 만드는 AI 에이전트 — Robota SDK 오픈소스 공개"
   - 내용: 왜 만들었는지, Claude Code와 무엇이 다른지, 플러그인 아키텍처 소개
2. **velog 기술 블로그 포스트**
   - "Claude Code 직접 만들어봤다 — Robota CLI 개발기"
   - 기술적 결정 이유, 어려웠던 점, 아키텍처 선택 배경
3. **okky 공유**
   - "AI 코딩 어시스턴트를 TypeScript SDK로 직접 만들 수 있는 오픈소스"
   - 커뮤니티 질의응답 적극 참여

4. **README.md 한국어 섹션**
   - GitHub 메인 README에 한국어 요약 추가 (접이식 섹션)

### robota.io 한국어 콘텐츠 강화

- `/ko` 랜딩 페이지의 카피를 마케팅 관점으로 개선
- "한국 개발자를 위한" 포인트 강조
- 한국 기업 사례/시나리오 추가

## 성공 기준

- GeekNews 포스트 게시 → 댓글 5개 이상
- velog 포스트 좋아요 50개 이상
- GitHub star 한국발 유입 측정 가능
- 커뮤니티 질문에 48시간 이내 답변 체계 구축
