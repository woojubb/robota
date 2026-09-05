/**
 * Ledgers whose closed records `scan-user-execution-plan-order.mjs` subject-binds to an exact Task
 * (its `UES_LEDGER`). `close` on one of these without `--ref` used to succeed and seal a record with
 * `ref: null` — unamendable (a closed record is never amended; a new run is opened instead) and
 * unusable as the checkpoint the plan-order gate requires. Refuse it here instead (issue #2568's
 * playbook, H5): every other loop in `loop-run.mjs` legitimately closes with no ref.
 */
const REF_REQUIRED_SKILLS = new Set(['user-execution-scenario']);

/** Throws when `skill` requires a non-empty `ref` to close and none was given. */
export function requireRefForClose(skill, ref) {
  if (REF_REQUIRED_SKILLS.has(skill) && (ref === null || ref.trim() === '')) {
    throw new Error(
      `loop-run: \`${skill}\` closes into a sealed, unamendable record — \`--ref\` naming the exact ` +
        'Task subject is required, or no checkpoint can ever bind to it.',
    );
  }
}
