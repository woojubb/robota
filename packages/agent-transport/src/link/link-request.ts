/**
 * The request line that opens an owner link, in the control endpoint's existing request shape so
 * the endpoint routes it like any other command. It names no runtime and no start: the binding is
 * proven inside the handshake, never taken from the request.
 */
export const LINK_PROTOCOL = 1;

/** Exactly what a client writes first, newline included. */
export const LINK_REQUEST_LINE = `${JSON.stringify({ command: 'link', protocol: LINK_PROTOCOL })}\n`;

/** Whether a parsed request line is exactly the link request; anything more or less is not. */
export function isLinkRequest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record['command'] === 'link' &&
    record['protocol'] === LINK_PROTOCOL
  );
}
