---
title: 'CLI-047: print 모드 구조화 exit code'
status: done
completed: 2026-05-25
created: 2026-05-24
priority: low
category: feature
---

## Outcome

Shipped in PR #589 (ba6c6036b, 2026-05-25) and still in place: README has an
"Exit Codes (print mode)" section (`packages/agent-cli/README.md` L179), stream-json error events
carry `error_code` (`packages/agent-transport/src/headless/headless-runner.ts` L120), and config
errors exit 3 (`cli.ts` `ProviderConfigError` → exit 3 in print mode). The exit-code contract was
later audited and hardened by CLI-064 (done). Verified 2026-07-25 (PROC-001).

## 문제

print 모드에서 에러 시 모두 `process.exit(1)`만 사용한다.
CI/CD 파이프라인에서 에러 유형을 구분할 수 없다.

현재 `stream-json` 포맷의 에러 이벤트에도 오류 코드 필드가 없다.

## 해결 방법

exit code 체계화:

```
0  — 정상 완료
1  — 일반 오류 (기존 동작 유지, 하위 호환)
2  — 인자 파싱 오류 (잘못된 플래그)
3  — 설정 오류 (프로바이더 미설정, API 키 없음)
4  — API 오류 (네트워크 실패, 인증 실패)
5  — 도구 실행 오류 (permission denied, 타임아웃)
```

`stream-json` 포맷의 에러 결과 이벤트에 `error_code` 필드 추가.

## 수용 기준

- [ ] 각 에러 유형에 대해 일관된 exit code 반환
- [ ] `stream-json` 에러 이벤트에 `error_code` 필드 포함
- [ ] exit code 표가 README에 문서화됨

## 관련 파일

- `packages/agent-cli/src/modes/print-mode.ts`
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/README.md`
