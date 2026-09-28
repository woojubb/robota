import { RobotaParticipantError } from './errors';

/**
 * Module-level set of every session, provider and tool object currently held by a live lease.
 *
 * A host's `createSessionOptions`/`createAgent` closure can, by mistake, hand the same `provider`
 * or tool instance to two concurrently open leases (two participants, or a retry that opened a
 * second session before the first released). Most providers and tools are not safe to drive from
 * two turns at once, so this is checked eagerly rather than left to surface as a data race.
 */
const held = new WeakSet<object>();

/**
 * Best-effort identity for the error message: a tool's `getName()`, a provider's `.name`, or the
 * constructor name as a last resort — whatever lets a host recognize WHICH resource collided
 * without this module knowing every resource type it might ever be handed.
 */
function describeResource(resource: object): string {
  const withGetName = resource as { getName?: unknown };
  if (typeof withGetName.getName === 'function') {
    try {
      const name = (withGetName.getName as () => unknown)();
      if (typeof name === 'string' && name) return name;
    } catch {
      // Fall through to another identifier; a broken getName() must not break this message.
    }
  }
  const withName = resource as { name?: unknown };
  if (typeof withName.name === 'string' && withName.name) return withName.name;
  return resource.constructor?.name || 'resource';
}

/**
 * Claim every resource in `resources` for one lease, atomically: if any is already held, none of
 * them is claimed. Returns a release callback; calling it more than once is a no-op.
 */
export function claimLease(resources: readonly object[]): () => void {
  const reused = resources.find((resource) => held.has(resource));
  if (reused)
    throw new RobotaParticipantError(
      'resource-reused',
      `${describeResource(reused)} is already held by another live lease`,
    );
  for (const resource of resources) held.add(resource);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const resource of resources) held.delete(resource);
  };
}
