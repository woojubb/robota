---
name: post-implementation-checklist
description: Complete a repository change through affected documentation, verification, review, merge, and authoritative closeout.
invocable: true
---

# Integrated Completion Checklist

Apply one completion boundary after implementation:

1. Update only affected package contracts, READMEs, guides, and API specifications.
2. Run `pnpm lint:fix:staged` for the staged unit; use `pnpm lint:fix` only when a whole-tree fix is
   intentional. Verify the post-fix tree with lint, type-check, and focused tests selected by the changed
   inputs. Prove bugfix regression tests RED then GREEN. Do not repeat identical successful inputs at
   pre-push.
3. Build affected product scope locally when needed. PR CI owns clean builds, shared artifacts, affected
   integration/consumer contracts, platform checks, security, and review policy.
4. Obtain one independent final review. Repair actionable findings in coherent batches and review meaningful
   repair deltas; do not repeat a clean review.
5. Verify the four stable required contexts, merge, independently verify the landing, clean up the branch,
   then update or close the authoritative issue/request.
6. Use versioning, publish, deploy, or release flows only when the request actually includes them; preserve
   their explicit permission and OTP boundaries.

Do not create a completion-only Task/spec move, committed loop ledger, receipt-only commit, N/A dispatch, or
unrelated full-repository audit.
