import type {
  ICommandExternalEventGrant,
  ICommandHostAdapterAccess,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

const GRANT_ID = /^[a-zA-Z0-9_-]{1,64}$/u;

function counts(values: Readonly<Partial<Record<string, number>>>): string {
  const entries = Object.entries(values).filter(([, count]) => (count ?? 0) > 0);
  return entries.length === 0
    ? 'none'
    : entries.map(([key, count]) => `${key} ${count}`).join(', ');
}

/** Label, principal kind, state and counts. The principal itself is never shown. */
function describe(grant: ICommandExternalEventGrant): string {
  const { counters } = grant;
  return (
    `  ${grant.grantId}  ${grant.principal}  ${grant.state}  accepted ${counters.accepted}; ` +
    `refused: ${counts(counters.refused)}; settled: ${counts(counters.settled)}`
  );
}

/**
 * `/events` — this session's external-event grants, and `/events revoke <grant-id>` to withdraw one.
 * Grants are given only when the session starts; nothing here creates one.
 */
export async function executeEventsCommand(
  context: ICommandHostAdapterAccess,
  args = '',
): Promise<ICommandResult> {
  const adapter = context.getCommandHostAdapters?.().externalEvents;
  if (!adapter) {
    return {
      message:
        'This session holds no external event grant. Grants are given only when a session starts.',
      success: true,
    };
  }
  const [verb, grantId, extra] = args
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '');
  if (verb === undefined) {
    const grants = adapter.list();
    return {
      message:
        grants.length === 0
          ? 'This session holds no external event grant.'
          : `External event grants:\n${grants.map(describe).join('\n')}\n\nWithdraw one: /events revoke <grant-id>`,
      success: true,
    };
  }
  if (
    verb !== 'revoke' ||
    grantId === undefined ||
    extra !== undefined ||
    !GRANT_ID.test(grantId)
  ) {
    return { message: 'Usage: /events  |  /events revoke <grant-id>', success: false };
  }
  return adapter.revoke(grantId) === 'revoked'
    ? {
        message: `Revoked external event grant ${grantId}. Later events for it are refused.`,
        success: true,
      }
    : { message: `This session holds no external event grant ${grantId}.`, success: false };
}
