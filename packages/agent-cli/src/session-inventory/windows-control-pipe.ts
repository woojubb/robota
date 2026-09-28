import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';

import koffi from 'koffi';

import {
  currentWindowsSid,
  readWindowsProcessIdentity,
  withWindowsPrivateDescriptor,
} from './windows-security.js';

export interface IControlChannel extends Duplex {
  setTimeout(milliseconds: number, callback?: () => void): this;
}

export function windowsControlPipePath(root: string, id: string): string {
  const name = createHash('sha256').update(root).update('\0').update(id).digest('hex').slice(0, 32);
  return `\\\\.\\pipe\\robota-supervised-${name}`;
}

function loadPipeApi() {
  if (process.platform !== 'win32') throw new Error('Windows control pipes require Windows.');
  const kernel = koffi.load('kernel32.dll');
  const attributes = koffi.struct({ length: 'uint32_t', descriptor: 'void*', inherit: 'int' });
  const overlapped = koffi.struct({
    internal: 'uintptr_t',
    high: 'uintptr_t',
    offset: 'uint32_t',
    offsetHigh: 'uint32_t',
    event: 'void*',
  });
  return {
    attributes,
    overlapped,
    create: kernel.func('__stdcall', 'CreateNamedPipeW', 'void*', [
      'str16',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      koffi.pointer(attributes),
    ]),
    open: kernel.func(
      'void* __stdcall CreateFileW(str16, uint32_t, uint32_t, void*, uint32_t, uint32_t, void*)',
    ),
    connect: kernel.func('int __stdcall ConnectNamedPipe(void*, void*)'),
    read: kernel.func('int __stdcall ReadFile(void*, void*, uint32_t, void*, void*)'),
    write: kernel.func('int __stdcall WriteFile(void*, void*, uint32_t, void*, void*)'),
    result: kernel.func('int __stdcall GetOverlappedResult(void*, void*, _Out_ uint32_t*, int)'),
    event: kernel.func('void* __stdcall CreateEventW(void*, int, int, str16)'),
    cancel: kernel.func('int __stdcall CancelIoEx(void*, void*)'),
    close: kernel.func('int __stdcall CloseHandle(void*)'),
    error: kernel.func('uint32_t __stdcall GetLastError()'),
    clientPid: kernel.func('int __stdcall GetNamedPipeClientProcessId(void*, _Out_ uint32_t*)'),
    serverPid: kernel.func('int __stdcall GetNamedPipeServerProcessId(void*, _Out_ uint32_t*)'),
  };
}

let cachedApi: ReturnType<typeof loadPipeApi> | undefined;
const api = () => (cachedApi ??= loadPipeApi());
const invalidHandle = (handle: unknown) => !handle || koffi.address(handle) === 0xffffffffffffffffn;

/** The buffers, event and OVERLAPPED remain alive until Windows reports completion, including cancellation. */
function performIo(
  handle: unknown,
  kind: 'connect' | 'read' | 'write',
  buffer?: Buffer,
): Promise<number> {
  const win = api();
  const event = win.event(null, 1, 0, null);
  if (!event) return Promise.reject(new Error('Unable to create Windows pipe I/O event.'));
  const state = koffi.alloc(win.overlapped, 1);
  koffi.encode(state, win.overlapped, { internal: 0n, high: 0n, offset: 0, offsetHigh: 0, event });
  const transferred = [0];
  const release = () => {
    koffi.free(state);
    win.close(event);
  };
  const started =
    kind === 'connect'
      ? win.connect(handle, state)
      : win[kind](handle, buffer, buffer!.length, null, state);
  const code = started ? 0 : win.error();
  if (started || (kind === 'connect' && code === 535)) {
    // Overlapped operations never retain an FFI temporary output pointer.
    const complete = kind === 'connect' || win.result(handle, state, transferred, 0);
    release();
    return complete
      ? Promise.resolve(transferred[0]!)
      : Promise.reject(new Error('Windows pipe I/O completion was refused.'));
  }
  if (code !== 997) {
    release();
    return Promise.reject(new Error('Windows pipe I/O was refused.'));
  }
  return new Promise<number>((resolve, reject) => {
    const poll = () => {
      // Do not occupy a finite FFI worker with an idle pipe read or accept.
      const completed = win.result(handle, state, transferred, 0);
      if (!completed && win.error() === 996) {
        setTimeout(poll, 10);
        return;
      }
      // Windows has completed this request, including cancellation, before release.
      if (!completed) reject(new Error('Windows pipe I/O ended.'));
      else if (buffer && transferred[0]! > buffer.length)
        reject(new Error('Invalid Windows pipe I/O size.'));
      else resolve(transferred[0]!);
    };
    poll();
  }).finally(release);
}

class WindowsPipeChannel extends Duplex implements IControlChannel {
  private readonly pending = new Set<Promise<unknown>>();
  private reading = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timeout = 0;

  constructor(
    private readonly handle: unknown,
    connecting = false,
  ) {
    super();
    if (connecting)
      setImmediate(() => {
        if (!this.destroyed) this.emit('connect');
      });
  }

  setTimeout(milliseconds: number, callback?: () => void): this {
    this.timeout = milliseconds;
    if (callback) this.once('timeout', callback);
    this.touch();
    return this;
  }

  private touch(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer =
      this.timeout > 0 ? setTimeout(() => this.emit('timeout'), this.timeout) : undefined;
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation),
    );
    return operation;
  }

  override _read(): void {
    if (this.reading || this.destroyed) return;
    this.reading = true;
    const buffer = Buffer.alloc(64 * 1024);
    void this.track(performIo(this.handle, 'read', buffer)).then(
      (length) => {
        this.reading = false;
        if (this.destroyed) return;
        this.touch();
        if (length === 0) this.push(null);
        else if (this.push(buffer.subarray(0, length))) this._read();
      },
      (error: Error) => {
        this.reading = false;
        if (!this.destroyed) this.destroy(error);
      },
    );
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const write = async () => {
      let offset = 0;
      while (offset < chunk.length) {
        if (this.destroyed) throw new Error('Windows pipe is closed.');
        const written = await this.track(performIo(this.handle, 'write', chunk.subarray(offset)));
        if (written <= 0) throw new Error('Windows pipe write made no progress.');
        offset += written;
        this.touch();
      }
    };
    void write().then(() => callback(), callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.setTimeout(0);
    api().cancel(this.handle, null);
    void Promise.allSettled([...this.pending]).then(() => {
      api().close(this.handle);
      callback(error);
    });
  }
}

function peerIdentity(
  handle: unknown,
  role: 'client' | 'server',
): { pid: number; startedAt: string } {
  const pid = [0];
  if (!api()[`${role}Pid`](handle, pid) || !pid[0])
    throw new Error('Unable to prove Windows pipe peer.');
  const identity = readWindowsProcessIdentity(pid[0]);
  if (!identity || identity.sid !== currentWindowsSid())
    throw new Error('Windows pipe peer is not this user.');
  return { pid: pid[0], startedAt: identity.startedAt };
}

/** Every instance rejects remote clients and carries an explicit owner-only DACL. */
export class WindowsControlPipeServer extends EventEmitter {
  private closed = false;
  private readonly accepts = new Map<unknown, Promise<void>>();

  constructor(private readonly connection: (channel: IControlChannel) => void) {
    super();
  }

  listen(path: string, ready: () => void): void {
    try {
      this.accept(path, true);
      queueMicrotask(ready);
    } catch (error) {
      queueMicrotask(() => this.emit('error', error));
    }
  }

  private accept(path: string, first: boolean): void {
    const win = api();
    const handle = withWindowsPrivateDescriptor((descriptor) =>
      win.create(path, 3 | 0x40000000 | (first ? 0x80000 : 0), 8, 255, 65536, 65536, 0, {
        length: koffi.sizeof(win.attributes),
        descriptor,
        inherit: 0,
      }),
    );
    if (invalidHandle(handle)) throw new Error('Unable to create protected Windows control pipe.');
    let transferred = false;
    const operation = performIo(handle, 'connect')
      .then(() => {
        if (this.closed) return;
        this.accept(path, false);
        try {
          peerIdentity(handle, 'client');
        } catch {
          // Reject this client without interrupting the next protected accept.
          return;
        }
        const channel = new WindowsPipeChannel(handle);
        transferred = true;
        this.connection(channel);
      })
      .catch((error) => {
        if (!this.closed) this.emit('error', error);
      })
      .finally(() => {
        this.accepts.delete(handle);
        if (!transferred) win.close(handle);
      });
    this.accepts.set(handle, operation);
  }

  close(done: () => void = () => undefined): void {
    this.closed = true;
    for (const handle of this.accepts.keys()) api().cancel(handle, null);
    void Promise.allSettled([...this.accepts.values()]).then(done);
  }
}

/** The actual connected handle must name the registered process start before any control bytes leave. */
export async function connectWindowsControlPipe(
  path: string,
  expected: { pid: number; startedAt: string },
  signal?: AbortSignal,
): Promise<IControlChannel> {
  const win = api();
  // SECURITY_IDENTIFICATION prevents the server from impersonating this client's token.
  const deadline = Date.now() + 2000;
  let handle: unknown;
  for (;;) {
    signal?.throwIfAborted();
    handle = win.open(path, 0xc0000000, 0, null, 3, 0x40000000 | 0x100000 | 0x10000, null);
    if (!invalidHandle(handle) || win.error() !== 231 || Date.now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  if (invalidHandle(handle)) throw new Error('Windows supervised control is unavailable.');
  try {
    signal?.throwIfAborted();
    const peer = peerIdentity(handle, 'server');
    if (peer.pid !== expected.pid || peer.startedAt !== expected.startedAt)
      throw new Error('Windows control pipe does not belong to the registered process start.');
    return new WindowsPipeChannel(handle, true);
  } catch (error) {
    win.close(handle);
    throw error;
  }
}
