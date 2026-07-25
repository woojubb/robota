/**
 * Low-level HTTP write/read helpers shared by the `dag studio` route handlers. Split out of
 * `http-server.ts` so that file stays within its size budget; behaviour is unchanged.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

const JSON_CT = 'application/json; charset=utf-8';

/** Collect a request body into a UTF-8 string. */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      chunks.push(c);
    });
    req.on('end', () => {
      res(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', rej);
  });
}

/**
 * Reply with JSON.
 *
 * SEC-006: no `Access-Control-Allow-Origin`. The studio UI is served from `/` on this very origin, so
 * it needs no CORS grant; a wildcard here let any web page the developer visited read these responses.
 */
export function jsonReply(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': JSON_CT,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Write one server-sent event frame, tolerating a client that has already disconnected. */
export function sendSSE(res: ServerResponse, data: unknown): void {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // allow-fallback: client disconnected mid-stream; write errors are silently dropped
  }
}
