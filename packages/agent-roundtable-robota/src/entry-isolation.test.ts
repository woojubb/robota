import { describe, expect, it, vi } from 'vitest';

// Optional (native-module isolation): `sessionParticipant` pulls in `@robota-sdk/agent-session`,
// which pulls in `@robota-sdk/agent-file-authority`'s native binary (koffi) — a cost a consumer who
// only wants `robotaParticipant`/`robotaSelector` should never pay just by importing this package's
// root entry. Mocking `@robota-sdk/agent-session` to throw on load turns "the root entry never
// reaches it" into something this test actually observes: if a later change reintroduces a value
// import of it from the root graph, loading `./index` below trips the mock and this test fails.
vi.mock('@robota-sdk/agent-session', () => {
  throw new Error('the root entry must never resolve @robota-sdk/agent-session');
});

describe('root entry native-module isolation', () => {
  it('loads with @robota-sdk/agent-session unresolvable', async () => {
    const mod = await import('./index');
    expect(typeof mod.robotaParticipant).toBe('function');
    expect(typeof mod.robotaSelector).toBe('function');
    // `sessionParticipant` moved to the `/session` subpath; the root module must not carry it.
    expect((mod as Record<string, unknown>).sessionParticipant).toBeUndefined();
  });

  it('does not export Session-specific checkpoint identifiers from the root entry', async () => {
    const mod = await import('./index');
    expect((mod as Record<string, unknown>).ROBOTA_SESSION_CHECKPOINT_VERSION).toBeUndefined();
    expect(mod.ROBOTA_AGENT_CHECKPOINT_VERSION).toBe('robota-agent/1');
  });
});
