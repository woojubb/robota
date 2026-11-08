/** @jest-environment node */
import { createIndexedDbBackend } from '../device-credential-store';

describe('configured credential database', () => {
  it('opens the selected product database without retaining another instance', async () => {
    const open = jest.fn((_name: string, _version: number) => {
      const request = { error: new Error('test stop'), onerror: undefined as undefined | (() => void) };
      queueMicrotask(() => request.onerror?.());
      return request;
    });
    const indexed = { open } as unknown as IDBFactory;
    const a = createIndexedDbBackend('product-a-credentials', indexed);
    const b = createIndexedDbBackend('product-b-credentials', indexed);
    await Promise.all([a.get('key').catch(() => {}), b.get('key').catch(() => {})]);
    await a.get('key').catch(() => {});
    expect(open.mock.calls).toEqual([
      ['product-a-credentials', 1],
      ['product-b-credentials', 1],
      ['product-a-credentials', 1],
    ]);
  });
});
