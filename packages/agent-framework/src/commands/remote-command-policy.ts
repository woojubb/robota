/**
 * Remote-command policy (REMOTE-003 Stage B1).
 *
 * Decides whether a command arriving from an **untrusted remote origin** (`source === 'remote'`: a WebSocket or
 * WebRTC peer) may execute. The gate is **deny-by-default**: a remote command runs only if it is read-only, or is
 * explicitly allowlisted. Local (`'user'`) and model (`'model'`) origins are never subject to this policy.
 *
 * "read-only" reuses the command's `requiresPermission`/`safety` metadata (a command is read-only when
 * `SystemCommandExecutor.resolveRequiresPermission(command) === false`). That metadata was authored as a
 * local-prompt / model-invocability signal; repurposing it as a remote-safety signal is acceptable only under the
 * REMOTE-001 co-drive model, where a paired remote has already passed pairing (Stage B3) and is an authorized
 * session viewer — read-only exposure (`/context`, `/status`) is within the accepted envelope. The allowlist is
 * the escape hatch for that semantic mismatch.
 */

/** Whether a remote-origin command may execute. `readOnly` = `resolveRequiresPermission(command) === false`. */
export interface IRemoteCommandPolicy {
  isAllowed(commandName: string, readOnly: boolean): boolean;
}

function normalizeCommandName(name: string): string {
  return name.trim().replace(/^\/+/, '');
}

/**
 * Default deny-by-default policy: a remote command is allowed iff it is read-only OR its name is on `allowlist`.
 * An empty allowlist (the default) permits only read-only commands from remote origins.
 */
export function createDefaultRemoteCommandPolicy(
  allowlist: readonly string[] = [],
): IRemoteCommandPolicy {
  const allowed = new Set(allowlist.map(normalizeCommandName));
  return {
    isAllowed(commandName: string, readOnly: boolean): boolean {
      return readOnly || allowed.has(normalizeCommandName(commandName));
    },
  };
}
