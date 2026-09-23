import type { IWorkspaceManifest } from './types.js';

/**
 * Refuse a manifest whose security-bearing fields the built-in applicator cannot enforce.
 *
 * Emptiness is what is checked, not presence: `environment: {}` and `permissions: {}` request
 * nothing, so refusing them would fail a caller that asked for no controls at all. `permissions`
 * counts as empty when neither list has an entry — `{ read: [] }` is a declared-but-empty policy,
 * not a policy.
 */
export function refuseUnenforceableManifestControls(manifest: IWorkspaceManifest): void {
  const unenforceable: string[] = [];

  if (manifest.environment && Object.keys(manifest.environment).length > 0) {
    unenforceable.push('environment');
  }

  // Read over the object's VALUES rather than naming `read` and `write`. Naming them is exhaustive
  // today by coincidence, not by construction: adding an `execute?: string[]` member to
  // `IWorkspaceManifestPermissions` would leave a named check silently not covering it, so a manifest
  // requesting `execute` would be accepted and ignored — this function's own defect, reintroduced,
  // with nothing failing.
  //
  // The emptiness rule differs by shape, and treating every member as array-valued would move the
  // coincidence rather than remove it: `.length` on a `boolean` member reads `undefined`, so
  // `{ network: true }` would pass unrefused, and on a `string` member it would refuse by accident.
  // An array can be present and request nothing, so it is judged empty-or-not; anything else is a
  // request by virtue of being there at all — including `false`, which asks for a control this
  // applicator equally cannot apply. This is a runtime boundary of a published package, so a
  // JavaScript caller can supply a member the type does not declare.
  const permissions = manifest.permissions;
  const requestsSomething = (value: string[] | undefined): boolean =>
    Array.isArray(value) ? value.length > 0 : value !== undefined;
  if (permissions && Object.values(permissions).some(requestsSomething)) {
    unenforceable.push('permissions');
  }

  if (unenforceable.length === 0) {
    return;
  }

  throw new Error(
    `workspace manifest requests ${unenforceable.join(' and ')}, which this sandbox client cannot ` +
      'enforce. The built-in applicator applies entries only. Supply a sandbox client that ' +
      'implements applyManifest and honours these fields, or remove them from the manifest — they ' +
      'were previously accepted and silently ignored, which reported a sandbox policy that was ' +
      'never applied (issue #2027).',
  );
}
