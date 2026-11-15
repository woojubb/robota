/**
 * Where a person's sign-in returns to. The person consents in the browser they are using for the
 * agent's page; the authorization server sends that browser back to a route on the page's own
 * origin, so the machine running the agent never needs a browser, a display or a second listener.
 *
 * The route is reached without the access cookie, because the cookie is `SameSite=Strict` and a
 * browser does not send it on a redirect from another site. What admits a request is what only the
 * sign-in and its authorization server know: its own `state`, compared in constant time, accepted
 * once and within a time limit. A request with any other `state` changes nothing.
 */
import { constantTimeEqual } from '@robota-sdk/agent-core';
import { MCPOAuthError, createPastedRedirectAcceptor } from '@robota-sdk/agent-mcp';

import type {
  IMCPOAuthCallbackListener,
  IMCPOAuthCallbackResult,
  IMCPOAuthCallbackServer,
  IMCPOAuthPastedRedirect,
} from '@robota-sdk/agent-mcp';

/** The path, on the page's own origin, a sign-in returns to. */
export const CONSENT_CALLBACK_PATH = '/connector-callback';

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
/** Sign-ins waiting for their redirect at once; each holds a timer and a `state`. */
const MAX_PENDING = 8;

export interface IConsentLanding {
  readonly status: number;
  readonly html: string;
}

export interface IConsentBroker {
  /** The redirect receiver for one sign-in, whose browser reaches this agent at `origin`. */
  listenerFor(origin: string): IMCPOAuthCallbackListener;
  /** What the browser is shown when it returns: fixed text, decided by the `state` it carries. */
  land(query: URLSearchParams): Promise<IConsentLanding>;
}

interface IPending {
  readonly state: string;
  readonly acceptor: IMCPOAuthPastedRedirect;
  readonly redirectUri: string;
  readonly settle: (outcome: IMCPOAuthCallbackResult | MCPOAuthError) => void;
}

function page(status: number, title: string, line: string): IConsentLanding {
  return {
    status,
    html: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px system-ui;margin:3rem auto;max-width:28rem;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${line}</p></body>`,
  };
}

const CONNECTED = page(
  200,
  'Connected',
  'You can close this tab and go back to your personal agent.',
);
const NOT_GRANTED = page(
  200,
  'Not connected',
  'The service did not grant access. You can close this tab and try again from your personal agent.',
);
const NOT_WAITING = page(
  400,
  'Nothing is waiting for this',
  'This sign-in is not waiting, or it already finished. Start it again from your personal agent.',
);

export function createConsentBroker(): IConsentBroker {
  const pending = new Set<IPending>();
  return {
    listenerFor(origin) {
      return {
        listen: async (options) => {
          if (pending.size >= MAX_PENDING) throw new MCPOAuthError('callback-unavailable');
          const redirectUri = new URL(CONSENT_CALLBACK_PATH, origin).href;
          let settle!: (outcome: IMCPOAuthCallbackResult | MCPOAuthError) => void;
          const outcome = new Promise<IMCPOAuthCallbackResult | MCPOAuthError>((resolve) => {
            settle = resolve;
          });
          const entry: IPending = {
            state: options.expectedState,
            acceptor: createPastedRedirectAcceptor({
              expectedState: options.expectedState,
              redirectUri,
            }),
            redirectUri,
            settle,
          };
          pending.add(entry);
          let timer: ReturnType<typeof setTimeout> | undefined;
          const server: IMCPOAuthCallbackServer = {
            redirectUri,
            wait: async () => {
              const ending = new Promise<MCPOAuthError>((resolve) => {
                timer = setTimeout(
                  () => resolve(new MCPOAuthError('callback-timeout')),
                  options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                );
                timer.unref();
                const cancel = (): void => resolve(new MCPOAuthError('cancelled'));
                if (options.signal?.aborted === true) cancel();
                else options.signal?.addEventListener('abort', cancel, { once: true });
              });
              const result = await Promise.race([outcome, ending]);
              if (result instanceof MCPOAuthError) throw result;
              return result;
            },
            close: async () => {
              if (timer !== undefined) clearTimeout(timer);
              pending.delete(entry);
            },
          };
          return server;
        },
        // A redirect nothing on this machine listens on is for pasting; this sign-in never pastes.
        freePort: async () => {
          throw new MCPOAuthError('callback-unavailable');
        },
      };
    },
    async land(query) {
      const state = query.get('state') ?? '';
      const entry = [...pending].find((candidate) => constantTimeEqual(candidate.state, state));
      if (entry === undefined) return NOT_WAITING;
      // Taken out first: a second request with the same `state` finds nothing waiting.
      pending.delete(entry);
      try {
        const url = new URL(entry.redirectUri);
        url.search = query.toString();
        entry.settle(entry.acceptor.accept(url.href));
        return CONNECTED;
      } catch (error) {
        entry.settle(
          error instanceof MCPOAuthError ? error : new MCPOAuthError('callback-invalid'),
        );
        return NOT_GRANTED;
      }
    },
  };
}
