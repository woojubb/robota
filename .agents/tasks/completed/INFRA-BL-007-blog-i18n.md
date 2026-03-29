# INFRA-BL-007: Blog Internationalization (i18n)

## Status: backlog

## Summary

블로그의 다국어 지원. 두 가지 범위가 있다.

### 1. 블로그 UI i18n

- 헤더, 푸터, 날짜 형식, 테마 토글 라벨 등 UI 텍스트 다국어 처리
- URL 구조: `/ko/blog/...`, `/en/blog/...` 또는 서브도메인
- Astro i18n 라우팅 활용 가능

### 2. 블로그 글 다국어 버전

- 같은 글을 한국어/영어 등 여러 언어로 작성
- 언어 전환 링크 (이 글의 영어 버전 보기)
- frontmatter에 `lang`, `translations` 필드 추가
- 예: `how-coding-agent-works.md` (ko) ↔ `how-coding-agent-works.en.md` (en)

## Research Needed

- Astro의 i18n 라우팅 (`i18n` config) 확인
- Content Collections에서 언어별 콘텐츠 관리 방법
- URL 구조 결정: path prefix (`/en/`) vs 파일명 suffix (`.en.md`)
- 기본 언어: ko, 추가 언어: en

## Dependencies

- 현재 블로그 구조 (apps/blog) 안정화 후 진행
