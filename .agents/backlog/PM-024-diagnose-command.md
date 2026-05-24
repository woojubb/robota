---
title: 'PM-024: robota --diagnose 자가 진단 커맨드'
status: done
created: 2026-05-24
priority: high
urgency: soon
area: packages/agent-cli
depends_on: []
---

## Background

사용자가 설치 후 "왜 안되지?"를 혼자 디버깅하는 시간을 줄여야 한다. GitHub Issues의 상당수는 "API 키 없음", "Node 버전 문제", "네트워크 접근 불가" 같은 환경 문제다. `--diagnose` 커맨드가 이를 자동으로 체크하고 해결책을 제시하면 support 비용이 크게 줄어든다.

## 작업 항목

### 체크 항목

```
robota --diagnose

✓ Node.js 22.14.0 (최소 요구: 22.0.0)
✓ @robota-sdk/agent-cli 2.0.0-beta.67
✗ ANTHROPIC_API_KEY 환경변수 없음
  → https://console.anthropic.com/settings/keys 에서 API 키를 생성하세요
  → 설정 방법: export ANTHROPIC_API_KEY=<your-key>
✓ 네트워크: api.anthropic.com 접근 가능 (latency: 234ms)
✓ 설정 파일: ~/.robota/settings.json
✗ 터미널 감지: Terminal.app (CJK 입력 불안정, iTerm2 권고)
  → iTerm2: https://iterm2.com
  → 대안: 한국어 입력은 영어로 질문 후 "한국어로 답해줘" 추가

종합: 1개 오류 발견. API 키를 설정하면 사용 가능합니다.
```

### 체크 목록

1. Node.js 버전 ≥ 22
2. 패키지 버전 (최신 beta vs 설치 버전 비교)
3. API 키 환경변수 존재 여부 (값 노출 없이 존재 여부만)
4. API 엔드포인트 네트워크 접근성 (timeout: 3000ms)
5. 터미널 종류 감지 (Terminal.app / iTerm2 / VSCode / Warp 등)
6. 설정 파일 존재 및 유효성
7. 권한 모드 설정값 확인

### 출력 형식

- 각 항목: ✓ (pass) / ✗ (fail) / ⚠ (warning)
- fail/warning 시 구체적 해결 방법 제시
- 마지막에 종합 요약

## 성공 기준

- `robota --diagnose` 실행 시 30초 이내 모든 체크 완료
- API 키 미설정 → 명확한 설정 방법 안내
- Node 버전 문제 → 업그레이드 방법 안내
- 네트워크 문제 → proxy 설정 힌트 제공
