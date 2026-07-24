/**
 * NEUT-001 — Robota's OWN self-hosting-verification command templates.
 *
 * This is the unpublished, repo-side home for the repo-process content evicted from
 * `@robota-sdk/agent-framework`'s `planSelfHostingVerification` (the library now takes
 * `{ baseRef, commandTemplates }` as injected config with no repo-specific defaults).
 * Compose these into the planner at a Robota composition root:
 *
 *   planSelfHostingVerification({
 *     changedFiles,
 *     packageScopes,
 *     baseRef: SELF_HOSTING_BASE_REF,
 *     commandTemplates: SELF_HOSTING_COMMAND_TEMPLATES,
 *   })
 */

/** Robota's default base ref for self-hosting verification. */
export const SELF_HOSTING_BASE_REF = 'origin/develop';

/**
 * Robota's `ISelfHostingCommandTemplates` value.
 * `{scope}` → package scope; `{baseRef}` → the plan's base ref.
 */
export const SELF_HOSTING_COMMAND_TEMPLATES = {
  packageVerify: [
    { name: 'test', template: 'pnpm --filter {scope} test' },
    { name: 'typecheck', template: 'pnpm --filter {scope} typecheck' },
    { name: 'build', template: 'pnpm --filter {scope} build' },
  ],
  repoVerify: {
    description: 'Run Robota harness verification as the local CI-like gate.',
    template: 'pnpm harness:verify -- --base-ref {baseRef} --skip-record-check',
  },
};
