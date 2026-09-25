import type {
  IExternalEventSource,
  IExternalEventSourceOptions,
} from '@robota-sdk/agent-framework';
import type { TMCPExternalEventListener } from '@robota-sdk/agent-mcp';

export interface IMcpExternalEventSession {
  openExternalEventSource(options: IExternalEventSourceOptions): Promise<IExternalEventSource>;
}

export interface IMcpExternalEventSubscriptionPort {
  subscribeExternalEvent(
    serverId: string,
    listener: TMCPExternalEventListener,
  ):
    | { readonly ok: true; readonly unsubscribe: () => void }
    | { readonly ok: false; readonly reason: string };
}

export interface IMcpExternalEventHost {
  /** Rebind after a TUI session switch; old sources stop admitting immediately. */
  bind(session: IMcpExternalEventSession): Promise<void>;
  close(): void;
}

/** Launch grants are exact server/sender pairs, never read from MCP definitions. */
function groupGrants(grants: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const grant of grants) {
    const separator = grant.indexOf(':');
    const serverId = grant.slice(0, separator);
    const senderId = grant.slice(separator + 1);
    const senders = grouped.get(serverId) ?? new Set<string>();
    senders.add(senderId);
    grouped.set(serverId, senders);
  }
  return new Map([...grouped].map(([serverId, senders]) => [serverId, [...senders]]));
}

/** The trusted MCP subscription binds a notification to this host-only proof, not event text. */
export function createMcpExternalEventHost(
  grants: readonly string[],
  mcp: IMcpExternalEventSubscriptionPort,
  report: (message: string) => void,
): IMcpExternalEventHost {
  const byServer = groupGrants(grants);
  let generation = 0;
  const active = new Map<
    string,
    {
      target?: { source: IExternalEventSource; proof: symbol };
      unsubscribe: () => void;
    }
  >();

  const close = (): void => {
    generation += 1;
    for (const binding of active.values()) {
      binding.unsubscribe();
      binding.target?.source.close();
    }
    active.clear();
  };

  const bind = async (session: IMcpExternalEventSession): Promise<void> => {
    const current = ++generation;
    // Keep the MCP subscription through recovery backoff. Dropping the final listener here
    // would cancel the supervisor's queued reconnect before the new TUI source exists.
    for (const binding of active.values()) {
      binding.target?.source.close();
      binding.target = undefined;
    }
    for (const [serverId, allowedSenders] of byServer) {
      const proof = Symbol(serverId);
      let source: IExternalEventSource;
      try {
        source = await session.openExternalEventSource({
          id: serverId,
          allowedSenders,
          authenticate: (raw) => {
            if (
              typeof raw !== 'object' ||
              raw === null ||
              !('proof' in raw) ||
              raw.proof !== proof
            ) {
              return null;
            }
            if (!('event' in raw) || typeof raw.event !== 'object' || raw.event === null)
              return null;
            const event = raw.event as Record<string, unknown>;
            if (
              typeof event['senderId'] !== 'string' ||
              typeof event['conversationId'] !== 'string' ||
              typeof event['content'] !== 'string'
            )
              return null;
            return {
              senderId: event['senderId'],
              conversationId: event['conversationId'],
              content: event['content'],
            };
          },
        });
      } catch {
        const previous = active.get(serverId);
        if (previous && current === generation) {
          previous.unsubscribe();
          active.delete(serverId);
        }
        report(`External event source "${serverId}" refused by session policy.`);
        continue;
      }
      if (current !== generation) {
        source.close();
        return;
      }
      let binding = active.get(serverId);
      if (!binding) {
        const next: {
          target?: { source: IExternalEventSource; proof: symbol };
          unsubscribe: () => void;
        } = {
          unsubscribe: () => undefined,
        };
        const subscription = mcp.subscribeExternalEvent(serverId, (event) => {
          const target = next.target;
          if (!target) return;
          void target.source
            .receive({ proof: target.proof, event })
            .then((receipt) => {
              if (receipt.outcome === 'refused') {
                report(
                  `External event source "${serverId}" refused an event: ${receipt.reason ?? 'unknown reason'}`,
                );
              }
              if (receipt.settled) {
                void receipt.settled
                  .then((settlement) => {
                    if (settlement.outcome !== 'completed') {
                      report(`External event source "${serverId}" turn ${settlement.outcome}.`);
                    }
                  })
                  .catch(() =>
                    report(`External event source "${serverId}" settlement failed unexpectedly.`),
                  );
              }
            })
            .catch(() =>
              report(`External event source "${serverId}" delivery failed unexpectedly.`),
            );
        });
        if (!subscription.ok) {
          source.close();
          report(`External event source "${serverId}" refused: ${subscription.reason}`);
          continue;
        }
        next.unsubscribe = subscription.unsubscribe;
        active.set(serverId, next);
        binding = next;
      }
      binding.target = { source, proof };
      report(`External event source "${serverId}" enabled for ${allowedSenders.length} sender(s).`);
    }
  };

  return { bind, close };
}
