# INFRA-BL-006: Migrate apps/docs to Cloudflare Pages

## Status: backlog

## Summary

apps/docs를 GitHub Pages에서 Cloudflare Pages로 이전한다. apps/blog과 동일한 인프라로 통일.

## Why

- 블로그(blog.robota.io)와 동일한 인프라 관리
- 서울 PoP으로 한국 접속 속도 향상
- 무제한 대역폭

## Scope

- Cloudflare Pages 프로젝트 생성 (robota.io용)
- 빌드 설정: `pnpm docs:build`, output: `apps/docs/.vitepress/dist`
- DNS 변경: robota.io → Cloudflare Pages
- 기존 gh-pages 배포 스크립트 제거 또는 백업
- `pnpm docs:deploy` 스크립트 업데이트

## Dependencies

- robota.io DNS를 Cloudflare로 관리 중이어야 함
- 블로그 CF Pages 배포가 안정화된 후 진행

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
