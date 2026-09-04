/**
 * Which WebSocket endpoint the monitor connects to.
 *
 * The CLI's HTTP server injects the URL through `<meta name="ws-url">`; when the tag is absent (or
 * empty) the monitor falls back to the page's own host, which is right whenever WS and HTTP share a
 * port. Pure so the selection is testable without a document (issue #2167).
 */
export function resolveWsUrl(metaContent: string | null | undefined, host: string): string {
  const injected = metaContent?.trim();
  return injected ? injected : `ws://${host}`;
}

/** Read the injected `<meta name="ws-url">` content from a document, if present. */
export function readInjectedWsUrl(doc: Pick<Document, 'querySelector'>): string | null {
  return doc.querySelector('meta[name="ws-url"]')?.getAttribute('content') ?? null;
}
