import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import { tempDir } from './harness.js';

export interface IAdminCall {
  method: string;
  path: string;
  contentType: string | undefined;
  body: string;
}

/**
 * A stand-in for the proxy's admin API on a Unix socket: it records every load and answers with
 * the status it is told to.
 */
export class FakeAdminSocket {
  readonly calls: IAdminCall[] = [];
  socketPath = '';
  private server: Server | undefined;
  private responses: Array<{ status: number; body: string }> = [];

  /** The next load is answered with this; later ones are accepted again. */
  failNext(status = 400, body = 'adapting config: unrecognized directive'): void {
    this.responses.push({ status, body });
  }

  async listen(): Promise<void> {
    this.socketPath = join(await tempDir(), 'admin.sock');
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        this.calls.push({
          method: req.method ?? '',
          path: req.url ?? '',
          contentType: req.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const answer = this.responses.shift() ?? { status: 200, body: '' };
        res.writeHead(answer.status);
        res.end(answer.body);
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(this.socketPath, resolve));
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
