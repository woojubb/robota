# INFRA-BL-006: Migrate apps/docs to Cloudflare Pages

## Status: completed

## Summary

apps/docs를 GitHub Pages에서 Cloudflare Pages로 이전한다. apps/blog과 동일한 인프라로 통일.

## Why

- 블로그(blog.robota.io)와 동일한 인프라 관리
- 서울 PoP으로 한국 접속 속도 향상
- 무제한 대역폭

## Scope

- [x] Cloudflare Pages 프로젝트 생성 (robota.io용)
- [x] 빌드 설정: `pnpm docs:build`, output: `apps/docs/.vitepress/dist`
- [x] DNS 변경: robota.io → Cloudflare Pages
- [x] 기존 gh-pages 배포 스크립트 제거 또는 백업
- [x] `pnpm docs:deploy` 스크립트 업데이트

## Dependencies

- robota.io DNS를 Cloudflare로 관리 중이어야 함
- 블로그 CF Pages 배포가 안정화된 후 진행

## 검증

- [x] `pnpm docs:build`
- [x] `node --check scripts/docs/deploy-cloudflare-pages.mjs`
- [x] `pnpm harness:scan:test-plans`
- [x] `pnpm harness:scan:consistency`
- [x] `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`

## Progress

### 2026-05-05

- Confirmed Cloudflare Pages PR checks are already active for the docs site.
- Replaced the remaining GitHub Pages deployment path with Cloudflare Pages deployment ownership.

## Decisions

- Production docs deployment is owned by Cloudflare Pages Git integration from `main`.
- `pnpm docs:deploy` remains as an explicit manual direct-upload helper using Wrangler.

## Result

- Removed the GitHub Pages deployment script and release workflow deployment step.
- Updated `pnpm docs:deploy` to build docs and run a Cloudflare Pages direct upload helper.
- Removed GitHub Pages `.nojekyll` generation from the docs build preparation script.
- Updated docs app SPEC and repository guidance to describe Cloudflare Pages ownership.
