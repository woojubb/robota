---
name: verification-guard
description: Run guarded example verification by aborting on failed execution or strict policy signals. Use when running example verification or guarded verification flows.
---

# Verification Guard

## Scope
Use this skill when running example workflows that must abort verification on failure or strict policy violations.

## Guarded Execution Template
```bash
cd /Users/jungyoun/Documents/dev/robota/packages/workflow/examples && \
FILE=guarded-edge-verification.ts && \
HASH=$(md5 -q "$FILE") && \
OUT=cache/guarded-edge-verification-$HASH-guarded.log && \
echo "▶️ Run example (guarded)..." && \
STATUS=0; npx tsx "$FILE" > "$OUT" 2>&1 || STATUS=$?; \
tail -n 160 "$OUT" | cat; \
if [ "$STATUS" -ne 0 ] || grep -E "\\[STRICT-POLICY\\]|\\[EDGE-ORDER-VIOLATION\\]" "$OUT" >/dev/null; then \
  echo "❌ Aborting verification (example failed or strict-policy violation)."; \
  exit ${STATUS:-1}; \
fi; \
echo "▶️ Verify..." && \
npx tsx utils/verify-workflow-connections.ts | cat
```

## Stop Conditions
- Non-zero exit code from example execution
- Log contains `[STRICT-POLICY]` or `[EDGE-ORDER-VIOLATION]`
- Expected output files are missing or empty

## Template Maintenance
- Keep verification commands in package-specific templates after example migration.
- Update templates after Phase 2 moves to reflect new example paths.
- Run guarded verification with the updated template before any verification step.
