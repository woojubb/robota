import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import type {
  HostedOrganizationControl,
  IHostedOrganizationWorker,
} from '../hosted-organization-control.js';
import { DesktopRefused } from './authorization.js';

export const DESKTOP_FRAME_BYTES = 128 * 1024;
const READS = new Set([
  'get-messages',
  'get-status',
  'get-context',
  'get-history',
  'get-prompts',
  'get-pending',
  'get-executing',
  'get-execution-workspace',
  'get-execution-detail',
  'project-status',
  'project-diff',
  'project-memory',
  'get-usage-report',
  'get-background-tasks',
  'list-models',
  'get-agent-definitions',
]);
const hidden = new Set([
  'sessions',
  'session_list',
  'session_renamed_in_list',
  'session_deleted',
  'ui_intent',
  'settings',
  'commands',
]);
export function desktopPromptDigest(event: Record<string, unknown>): string {
  return createHash('sha256')
    .update('robota/desktop-permission/v1\0')
    .update(JSON.stringify(event))
    .digest('hex');
}
/** One owner-held carrier connection pins the worker's session across desktop reconnects. */
export class HostedDesktopWorkerPort {
  readonly session: string;
  private readonly listeners = new Set<(frame: Record<string, unknown>) => void>();
  private readonly ended = new Set<() => void>();
  private readonly pending = new Map<string, { digest: string; event: Record<string, unknown> }>();
  private constructor(
    private readonly socket: WebSocket,
    session: string,
    readonly worker: IHostedOrganizationWorker,
  ) {
    this.session = session;
    socket.on('message', (bytes, binary) => {
      try {
        if (binary || Buffer.byteLength(String(bytes)) > DESKTOP_FRAME_BYTES)
          throw new DesktopRefused('worker-frame');
        const frame = JSON.parse(String(bytes)) as Record<string, unknown>;
        if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string')
          throw new DesktopRefused('worker-frame');
        if (
          (frame.type === 'session_status' &&
            (frame.status as { sessionId?: unknown })?.sessionId !== this.session) ||
          frame.type === 'session_switched'
        )
          throw new DesktopRefused('worker-session-changed');
        if (hidden.has(frame.type)) return;
        if (frame.type === 'permission_request') {
          const event = frame.event as Record<string, unknown>;
          if (
            !event ||
            typeof event.id !== 'string' ||
            event.id.length > 256 ||
            typeof event.toolName !== 'string' ||
            this.pending.size >= 32
          )
            throw new DesktopRefused('worker-prompt');
          this.pending.set(event.id, { digest: desktopPromptDigest(event), event });
        }
        if (frame.type === 'prompt_resolved')
          this.pending.delete((frame.event as { id: string })?.id);
        for (const listener of this.listeners) listener(frame);
      } catch {
        this.close();
      }
    });
    socket.on('error', () => this.close());
    socket.on('close', () => {
      for (const listener of this.ended) listener();
      this.listeners.clear();
      this.ended.clear();
      this.pending.clear();
    });
  }
  static async connect(options: {
    readonly endpoint: string;
    readonly token: string;
    readonly worker: IHostedOrganizationWorker;
    readonly control: HostedOrganizationControl;
    readonly session?: string;
    readonly signal?: AbortSignal;
  }): Promise<HostedDesktopWorkerPort> {
    const url = new URL(options.endpoint);
    if (
      url.protocol !== 'ws:' ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      typeof options.token !== 'string' ||
      options.token.length < 16 ||
      options.token.length > 8192
    )
      throw new DesktopRefused('owner-worker-endpoint');
    const signal = AbortSignal.any([
      AbortSignal.timeout(5000),
      ...(options.signal ? [options.signal] : []),
    ]);
    await options.control.admit(options.worker, signal);
    url.searchParams.set('token', options.token);
    const socket = new WebSocket(url, {
      maxPayload: DESKTOP_FRAME_BYTES,
      handshakeTimeout: 5000,
      followRedirects: false,
    });
    try {
      const session = await new Promise<string>((resolve, reject) => {
        let buffered = 0;
        const fail = (): void => reject(new DesktopRefused('worker-unavailable'));
        const receive = (data: unknown, binary: boolean): void => {
          try {
            buffered += Buffer.byteLength(String(data));
            if (binary || buffered > 1024 * 1024) return fail();
            const frame = JSON.parse(String(data)) as {
              type?: string;
              status?: { sessionId?: unknown };
            };
            if (frame.type !== 'session_status') return;
            const id = frame.status?.sessionId;
            if (
              typeof id !== 'string' ||
              id.length === 0 ||
              id.length > 256 ||
              (options.session !== undefined && id !== options.session)
            )
              return fail();
            resolve(id);
          } catch {
            fail();
          }
        };
        socket.once('open', () => socket.send(JSON.stringify({ type: 'get-status' })));
        socket.on('message', receive);
        socket.once('error', fail);
        socket.once('close', fail);
        signal.addEventListener('abort', fail, { once: true });
        const detach = (): void => {
          socket.off('message', receive);
          socket.off('error', fail);
          socket.off('close', fail);
          signal.removeEventListener('abort', fail);
        };
        socket.once('close', detach);
        // Detach discovery before the permanent receiver is installed.
        socket.on('message', function done(data) {
          try {
            if (JSON.parse(String(data)).type === 'session_status') {
              detach();
              socket.off('message', done);
            }
          } catch {
            /* Discovery refuses malformed frames through its receiver above. */
          }
        });
      });
      signal.throwIfAborted();
      await options.control.admit(options.worker, signal);
      signal.throwIfAborted();
      return new HostedDesktopWorkerPort(
        socket,
        session,
        Object.freeze(structuredClone(options.worker)),
      );
    } catch {
      socket.terminate();
      throw new DesktopRefused('worker-unavailable');
    }
  }
  onFrame(listener: (frame: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onClose(listener: () => void): () => void {
    this.ended.add(listener);
    return () => this.ended.delete(listener);
  }
  ready(): void {
    if (this.socket.readyState !== WebSocket.OPEN) throw new DesktopRefused('worker-unavailable');
  }
  send(frame: Record<string, unknown>): Record<string, unknown> | undefined {
    this.ready();
    const bytes = JSON.stringify(frame);
    if (Buffer.byteLength(bytes) > DESKTOP_FRAME_BYTES || this.socket.bufferedAmount > 1024 * 1024)
      throw new DesktopRefused('frame-capacity');
    if (frame.type === 'get-commands') return { type: 'commands', commands: [], skills: [] };
    if (frame.type === 'list-sessions' && typeof frame.requestId === 'string')
      return {
        type: 'sessions',
        requestId: frame.requestId,
        listing: { currentSessionId: this.session, sessions: [], unreadableSessionIds: [] },
      };
    if (frame.type === 'submit') {
      if (
        typeof frame.prompt !== 'string' ||
        /^\s*\//u.test(frame.prompt) ||
        Object.keys(frame).some((key) => !['type', 'prompt'].includes(key))
      )
        throw new DesktopRefused('remote-command');
    } else if (
      !READS.has(String(frame.type)) &&
      frame.type !== 'abort' &&
      frame.type !== 'ask-response'
    )
      throw new DesktopRefused('remote-capability');
    if ('sessionId' in frame || 'driverId' in frame || 'tenant' in frame || 'task' in frame)
      throw new DesktopRefused('remote-ownership');
    this.socket.send(bytes);
    return undefined;
  }
  prompt(id: string, digest: string): void {
    if (this.pending.get(id)?.digest !== digest) throw new DesktopRefused('stale-approval');
  }
  approve(id: string, digest: string, allow: boolean): void {
    this.ready();
    this.prompt(id, digest);
    this.pending.delete(id);
    this.socket.send(JSON.stringify({ type: 'permission-response', id, result: allow }));
  }
  close(): void {
    this.socket.terminate();
  }
}
