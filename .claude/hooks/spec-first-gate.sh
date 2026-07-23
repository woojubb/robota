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
# Trigger design (HARNESS-DIET-006): the old keyword list (\bcode\b, \badd\b, \bchange\b,
# \bwrite\b, \bfix\b, bare 수정/변경/추가 …) fired on nearly every dev prompt, so the
# advisory became noise. The spec gate is about NEW FEATURE work — bugfixes, tweaks, and
# doc edits are governed by other gates (scan-spec-research + GATE-WRITE do the real
# enforcement). So the trigger now requires STRONG new-feature-implementation intent:
#   English: "implement", an explicit "feature" object after build/create/develop/add
#            ("add a new feature", "build the feature"), "new feature", or
#            build/create/develop + "a new <thing>" ("create a new command").
#   Korean:  구현 (implement), or 기능 (feature) combined with 추가/만들/개발
#            ("기능을 추가", "새 기능", "새로운 기능을 만들"), or 새로 개발/새로 만들.
# Bare verbs (add/fix/change/write/code/create-a-PR, 수정/고쳐/변경/추가/만들) no longer
# fire — they cover almost every dev prompt without signaling new-feature scope.

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

# Detect STRONG new-feature-implementation intent only (rationale in header comment)
HAS_IMPL_INTENT=$(printf '%s' "$PROMPT" | grep -Eio \
  '구현해|구현하|구현 해|기능을? ?(추가|만들|개발)|새 ?기능|새로운 기능|신규 기능|새로 (개발|만들)|\bimplement\b|\bnew feature\b|\b(build|create|develop|add) (a|an|the) (new )?feature\b|\b(build|create|develop) (a|an) new\b' \
  | head -n 1 || true)

if [ -z "$HAS_IMPL_INTENT" ]; then
  exit 0
fi

# Output SPEC-GATE reminder (stdout gets injected as <user-prompt-submit-hook> context)
cat <<'EOF'
⚠️  SPEC-GATE: Implementation intent detected.

MANDATORY SEQUENCE before writing any code (.ts/.tsx/.js files):

1. Read-only code exploration is allowed (Read, grep, find — no Write/Edit to .ts files).
2. Create a backlog draft: `.agents/spec-docs/draft/<TYPE>-NNN-<slug>.md`
   → Use skill: `backlog-writer` to author it
   → Required frontmatter: status, type, tags
   → DEFAULT-ON: include a substantiated `## Prior Art Research` section (dispatch the
     `prior-art-researcher` agent) — comparable products/OSS/AI-agent refs from PRODUCT DOCS, feeding an
     evidence-based recommendation. Opt out only with an explicit `Waived: <reason>`. Enforced by
     `scan-spec-research.mjs` + GATE-WRITE. Per `.agents/rules/research.md`.
3. Run gate pipeline: `backlog-pipeline` (GATE-WRITE → GATE-APPROVAL)
4. Only after GATE-APPROVAL passes: implement.

Per HARD GATE rule in `.agents/rules/spec-workflow.md` and `.agents/rules/research.md` (research is default-on).
If the user explicitly waives the gate ("skip spec", "just fix it"), document the waiver in your response before proceeding.
EOF

exit 0
