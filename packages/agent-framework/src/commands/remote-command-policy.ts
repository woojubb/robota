/**
 * Command-execution policy for transport-origin (`source === 'remote'`) commands (REMOTE-006).
 *
 * **Local and remote are the same layer** (owner principle, 2026-07-11): pairing (Stage B3) is the sole trust
 * boundary — a paired peer is the session owner, identical to the local operator — and capability is governed
 * uniformly by the universal permission system (permission modes + `PermissionEnforcer` + the ask/approval
 * handler), not by an origin penalty. So this policy is **allow-by-default**: a transport-origin command behaves
 * exactly like a locally-typed one. It exists ONLY as an **optional, user-configured** restriction seam for a
 * consumer that explicitly wants to constrain a driver; nothing built-in denies by origin. The `'remote'` source
 * tag survives purely for attribution/telemetry + this optional seam.
 *
 * (Supersedes the REMOTE-003 origin-discriminating framing, which denied remote commands by default and gated
 * only the narrow `command` verb while the model's tools/skills — the dominant side-effecting routes — were never
 * gated.)
 */

/** Optional restriction seam. `readOnly` = `resolveRequiresPermission(command) === false`. Returns whether the command may execute. */
export interface IRemoteCommandPolicy {
  isAllowed(commandName: string, readOnly: boolean): boolean;
}

/**
 * The default policy: **allow all** (local == remote). A transport-origin command runs exactly as a locally-typed
 * one; the universal permission system governs anything dangerous. Provide a custom {@link IRemoteCommandPolicy}
 * only to opt into a restriction.
 */
export function createDefaultRemoteCommandPolicy(): IRemoteCommandPolicy {
  return {
    isAllowed(): boolean {
      return true;
    },
  };
}
