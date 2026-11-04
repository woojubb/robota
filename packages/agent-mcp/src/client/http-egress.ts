/**
 * The host's HTTP network, as a port.
 *
 * Which destinations an MCP server may be reached at, and how each request gets there, depend on
 * the host: a Node process resolves names, refuses private and metadata addresses and connects only
 * to the addresses it checked (`createNodeHttpEgress` on `@robota-sdk/agent-mcp/node`); a browser
 * has neither DNS nor a connection to pin, and its own sandbox decides what it can reach. This
 * entry is platform-neutral, so it holds the port and the one host-independent implementation —
 * web `fetch`, with no destination check beyond `http:`/`https:` — and the HTTP transport has no
 * default of its own: a composition root always injects one, so choosing the web one is a decision
 * written down, never an omission.
 */

/** A destination the host's network refuses, named by a reason and a message safe to print. */
export interface IMCPEgressRefusal {
  /** `unresolvable` is the one the supervisor reads: a name that did not resolve may resolve later. */
  readonly reason: string;
  readonly message: string;
}

/** The one request path of one admitted endpoint: every request, retry and reconnect uses it. */
export interface IMCPHttpCarrier {
  readonly fetch: typeof globalThis.fetch;
  /** Aborts when the carrier closes, so a request waiting on the host's network stops with it. */
  readonly signal: AbortSignal;
  /** Withdraws every request still open and waits for their connections to be released. */
  close(): Promise<void>;
}

export interface IMCPHttpEgress {
  /**
   * Judges a destination before anything connects or is authorized. Resolves to the refusal, or to
   * `undefined` when the destination may be reached.
   */
  admit(url: URL): Promise<IMCPEgressRefusal | undefined>;
  /**
   * Opens the carrier for one admitted endpoint. It sends to that endpoint's URL only: any other
   * URL is refused with {@link MCPTransportEgressRefusedError} (`endpoint-mismatch`).
   */
  open(endpoint: string): IMCPHttpCarrier;
}

/**
 * A request the carrier refused to send. Names the refusal only: no URL, query, header or text from
 * the carrier, any of which can contain an owner credential.
 */
export class MCPTransportEgressRefusedError extends Error {
  constructor(readonly reason: string) {
    super(`Streamable HTTP transport refused egress (${reason})`);
    this.name = 'MCPTransportEgressRefusedError';
  }
}

/**
 * Web `fetch` and no more: the destination only has to be an `http:` or `https:` URL, and nothing
 * resolves, pins or classifies an address, so it reaches whatever the platform lets `fetch` reach —
 * loopback, private ranges and cloud-metadata addresses included on a host that has them. A browser
 * host passes it as `{ egress: createWebFetchEgress() }`; a host that runs on a server passes an
 * egress that judges destinations instead (`createNodeHttpEgress` on Node). `fetchImpl` defaults to
 * the global `fetch`.
 */
export function createWebFetchEgress(fetchImpl?: typeof globalThis.fetch): IMCPHttpEgress {
  return {
    admit: async (url) =>
      url.protocol === 'http:' || url.protocol === 'https:'
        ? undefined
        : { reason: 'unsupported_scheme', message: 'Only http(s) URLs may be fetched.' },
    open: (endpoint) => {
      const lifetime = new AbortController();
      const send: typeof globalThis.fetch = async (input, init) => {
        const inputUrl = input instanceof Request ? input.url : String(input);
        if (inputUrl !== endpoint) throw new MCPTransportEgressRefusedError('endpoint-mismatch');
        const signal =
          init?.signal === undefined || init.signal === null
            ? lifetime.signal
            : AbortSignal.any([lifetime.signal, init.signal]);
        return (fetchImpl ?? globalThis.fetch)(input, { ...init, signal, redirect: 'manual' });
      };
      return {
        fetch: send,
        signal: lifetime.signal,
        close: async () => lifetime.abort(),
      };
    },
  };
}
