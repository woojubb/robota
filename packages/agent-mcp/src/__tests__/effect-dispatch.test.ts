import { describe, expect, it, vi } from 'vitest';

import { MCPDispatchAdmissions, withDispatchAdmission } from '../client/effect-dispatch.js';

const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write' } };

describe('tool request dispatch admission', () => {
  it('refuses an unsupported carrier before it starts the request', () => {
    const start = vi.fn(async () => undefined);
    expect(() =>
      withDispatchAdmission({}, async (dispatch) => ({ response: dispatch() }), start),
    ).toThrow(/cannot admit/u);
    expect(start).not.toHaveBeenCalled();
  });

  it('keeps a cancelled request closed while a delayed carrier is still preparing it', async () => {
    const guard = new MCPDispatchAdmissions();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(async () => new Response('ok'));
    let carrier!: Promise<Response>;
    const result = guard.run(
      async (dispatch) => ({ response: dispatch() }),
      () => {
        const id = guard.attach(message)!;
        carrier = gate.then(() => guard.send(message, send)).finally(() => guard.sent(id));
        return Promise.reject(new Error('cancelled'));
      },
    );
    await expect(result).rejects.toThrow(/cancelled/u);
    release();
    await expect(carrier).rejects.toThrow(/cancelled/u);
    expect(send).not.toHaveBeenCalled();
  });
});
