#!/usr/bin/env bash
# UserPromptSubmit hook: inject SPEC-GATE reminder when implementation intent is detected.
#
# Reads the user prompt and checks for implementation/development/fix keywords.
# If found (and not already referencing spec/backlog), outputs a SPEC-GATE reminder
# that is injected into the agent context via <user-prompt-submit-hook>.
#
# Read-only code exploration (Read, grep, find) is always allowed.
# Before writing ANY code (.ts/.tsx/.js changes), the change's lane is declared and that lane's
# gates have passed (PROC-016: L0 has no spec document, L1 one document and the PLAN gate, L2 the
# five gates) — `.agents/rules/spec-workflow.md` § Lanes owns the lanes; this reminder points at it.
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

# One reader for a payload field, not one per hook. See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

INPUT=$(cat)

# This hook carried its own `read_json()` — jq, and NO python3 fallback — copied byte-for-byte into
# correction-detect and revert-detect. Measured on a host with jq hidden: this gate printed nothing
# at all while branch-guard beside it kept working, so half the directory was silently off and the
# other half was not. The shared reader falls back to python3, so both halves answer the same.
PROMPT=$(hook_prompt_of "$INPUT" || printf '')
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
2. Derive the lane from the paths the change will touch, per `.agents/rules/spec-workflow.md` § Lanes,
   and declare it — `Lane: L0|L1|L2` — on the branch (commit trailer) and the pull request (body).
   The lane is the diff's floor: `scan-lane-declaration` refuses a declaration under it, and no
   argument lowers it.
   → L0 (no non-comment change under `src/` or `scripts/`, nothing on an L2 path — the floors table in spec-workflow.md § Lanes is the owner): no spec document.
   → L1 (a non-comment `src/` change, no L2 path): scaffold the spec document with
     `node scripts/harness/new-spec.mjs <ID> --type <T> --issue <N> --lane L1`.
   → L2 (any L2 path): create a backlog draft `.agents/spec-docs/draft/<TYPE>-NNN-<slug>.md`
     → Use skill: `backlog-writer` to author it
     → Required frontmatter: status, type, tags, lane
     → DEFAULT-ON: include a substantiated `## Prior Art Research` section (dispatch the
       `prior-art-researcher` agent) — comparable products/OSS/AI-agent refs from PRODUCT DOCS, feeding an
       evidence-based recommendation. Opt out only with an explicit `Waived: <reason>`. Enforced by
       `scan-spec-research.mjs` + GATE-WRITE. Per `.agents/rules/research.md`.
3. Run the lane's gates: L1 = PLAN via `node scripts/harness/gate.mjs judge --gate PLAN`;
   L2 = the five spec-document gates via `backlog-pipeline` (GATE-WRITE → … → GATE-APPROVAL).
   L0 has no gate before code — CI, the reviewer verdict and the merge gate judge it.
4. Only after the lane's gates pass: implement.

Per `.agents/rules/spec-workflow.md` § Lanes and § HARD GATE, and `.agents/rules/research.md` (research is default-on).
There is NO waiver. A user instruction to shorten the path ("skip spec", "just fix it") is a FAST TRACK:
record `Fast-track: <the instruction, quoted verbatim>` on the pull request — the PR is the record, not
your response — never on a path whose floor is L2 (`scan-lane-declaration` refuses it), and the lane
stays the diff's.
EOF

exit 0
