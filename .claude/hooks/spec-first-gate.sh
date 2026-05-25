#!/usr/bin/env bash
# UserPromptSubmit hook: inject SPEC-GATE reminder when implementation intent is detected.
#
# Reads the user prompt and checks for implementation/development/fix keywords.
# If found (and not already referencing spec/backlog), outputs a SPEC-GATE reminder
# that is injected into the agent context via <user-prompt-submit-hook>.
#
# Read-only code exploration (Read, grep, find) is always allowed.
# Before writing ANY code (.ts/.tsx/.js changes), a spec draft must exist.
#
# Keywords detected:
#   Korean: 개발, 구현, 만들, 추가, 수정, 고쳐, 개선, 작성, 변경, 삭제, 제거, 기능, 버그, 수정해
#   English: implement, develop, build, create, add, fix, modify, change, refactor, delete, remove

set -uo pipefail

INPUT=$(cat)

read_json() {
  local expression="$1"
  if [ -z "$INPUT" ]; then
    echo ""
    return
  fi
  printf '%s' "$INPUT" | jq -r "$expression // \"\"" 2>/dev/null || echo ""
}

PROMPT=$(read_json '.prompt // .user_prompt // .message')
if [ -z "$PROMPT" ]; then
  exit 0
fi

# Check if the prompt already contains spec/backlog references (user already knows)
HAS_SPEC_REF=$(printf '%s' "$PROMPT" | grep -Eio '스펙|백로그|spec.doc|spec-doc|backlog|draft|spec-first|HARD.GATE|spec_doc|spec/|SPEC\.md' | head -n 1 || true)
if [ -n "$HAS_SPEC_REF" ]; then
  exit 0
fi

# Detect implementation intent keywords (Korean + English)
HAS_IMPL_INTENT=$(printf '%s' "$PROMPT" | grep -Eio \
  '개발해|개발하|개발 해|구현해|구현하|구현 해|만들어|만들어 줘|만들어줘|추가해|추가하|추가 해|수정해|수정하|수정 해|고쳐|고쳐줘|개선해|개선하|개선 해|작성해|작성하|작성 해|변경해|변경하|변경 해|삭제해|삭제하|삭제 해|제거해|제거하|제거 해|기능을 만|기능을 추가|버그를 고|오류를 고|에러를 고|\bimplement\b|\bdevelop\b|\bbuild\b|\bcreate\b|\badd\b|\bfix\b|\bmodify\b|\bchange\b|\brefactor\b|\bdelete\b|\bremove\b|\bwrite\b|\bcode\b' \
  | head -n 1 || true)

if [ -z "$HAS_IMPL_INTENT" ]; then
  exit 0
fi

# Check if it's a trivially non-code request (config/docs/settings/README)
IS_DOC_ONLY=$(printf '%s' "$PROMPT" | grep -Eio \
  '문서|README|주석|comment|설명|설정 파일|config.*파일|\.md$|\.json$|룰|규칙 파일' \
  | head -n 1 || true)

# Output SPEC-GATE reminder (stdout gets injected as <user-prompt-submit-hook> context)
cat <<'EOF'
⚠️  SPEC-GATE: Implementation intent detected.

MANDATORY SEQUENCE before writing any code (.ts/.tsx/.js files):

1. Read-only code exploration is allowed (Read, grep, find — no Write/Edit to .ts files).
2. Create a backlog draft: `.agents/spec-docs/draft/<TYPE>-NNN-<slug>.md`
   → Use skill: `backlog-writer` to author it
   → Required frontmatter: status, type, tags
3. Run gate pipeline: `backlog-pipeline` (GATE-WRITE → GATE-APPROVAL)
4. Only after GATE-APPROVAL passes: implement.

Per HARD GATE rule in `.agents/rules/spec-workflow.md`.
If the user explicitly waives the gate ("skip spec", "just fix it"), document the waiver in your response before proceeding.
EOF

exit 0
