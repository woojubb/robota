---
title: 'PM-028: 외부 베타 초대 프로그램 — early adopter 확보'
status: superseded
completed: 2026-07-25
created: 2026-05-24
priority: medium
urgency: soon
area: apps/www
depends_on: []
---

> **Superseded by WEB-008 (done) for the shipped artifact.** The `/beta` signup page shipped in
> PR #589 (`apps/www/src/app/[locale]/beta/page.tsx`, 2026-05-25) and its broken submit flow +
> i18n were fixed by WEB-008. The program operations (recruiting 10 early adopters, Discord/
> Discussions channel, interviews, NPS) are manual owner-run actions that never happened and have
> no agent-executable remainder. Reconciled 2026-07-25 (PROC-001).

## Background

현재 베타는 npm에 공개되어 있지만 "베타 사용자" 커뮤니티가 없다. 사용 피드백이 없으면 무엇을 개선해야 할지 모른다. 외부 개발자 10-20명이 실제 프로젝트에서 쓰면서 보내는 피드백이 내부 테스트 100번보다 가치 있다.

목표: 일주일 내 10명의 early adopter를 확보하고, 그들의 피드백을 백로그에 반영.

## 작업 항목

### 베타 초대 페이지 (robota.io/beta)

```
Robota CLI 베타 테스터 모집

실제 프로젝트에서 AI 코딩 어시스턴트를 테스트해보고 싶으신가요?
초기 10명에게 직접 지원을 제공합니다.

[이름] [이메일] [현재 사용 중인 도구] [기대하는 use case]
→ [베타 신청하기]
```

### 베타 프로그램 운영

1. 신청 폼 (Google Forms 또는 simple form)
2. 신청자에게 48시간 내 응답 + 온보딩 가이드 전송
3. 전용 Discord 채널 또는 GitHub Discussion
4. 2주 후 인터뷰 (30분, Zoom 또는 Google Meet)
5. 피드백을 백로그 이슈로 변환

### 모집 채널

- GeekNews (PM-027과 연계)
- 개발자 인맥 직접 초대
- Twitter/X 포스트
- LinkedIn

## 성공 기준

- 2주 내 외부 베타 사용자 10명 확보
- 각 사용자로부터 최소 3개 피드백 수집
- 수집된 피드백 중 2개 이상이 기존 백로그에 없던 새로운 이슈
- NPS (Net Promoter Score) 측정 시작
