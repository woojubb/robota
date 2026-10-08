import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

const HEADLESS_BLOCKING_STATES = new Set([
  'untrusted',
  'revoked',
  'stale/replaced',
  'store-unavailable',
]);

export function requiresHeadlessWorkspaceTrust(access: TWorkspaceProjectAccess): boolean {
  return access.status === 'restricted' && HEADLESS_BLOCKING_STATES.has(access.trustState);
}

export function formatHeadlessWorkspaceTrustError(
  access: TWorkspaceProjectAccess,
  cwd: string,
  cliName: string,
): string {
  const state = access.status === 'trusted' ? 'trusted' : access.trustState;
  const workspace = access.status === 'trusted' ? access.identity.displayPath : access.displayPath;
  const location = workspace ?? cwd;
  return [
    `Workspace trust is required before headless startup (state: ${state}).`,
    `Workspace: ${location}`,
    'Project settings, hooks, plugins, skills, and provider overrides were not loaded.',
    `Grant access with: ${cliName} trust --yes`,
    // #3282 §3: this refusal is the only thing a non-interactive `--serve --open` (or any other
    // headless start with no TTY to ask on) ever sees, so it names the other way past it too.
    'Or start without project sources with: --restricted-workspace',
  ].join('\n');
}

/** Explain the project settings withheld by an explicit headless Restricted start. */
export function formatHeadlessRestrictedNotice(
  projectSettingsPaths: readonly { readonly relativePath: string }[],
): string {
  return `Restricted workspace mode: project settings are ignored (${projectSettingsPaths.map((entry) => entry.relativePath).join(', ')}).`;
}
