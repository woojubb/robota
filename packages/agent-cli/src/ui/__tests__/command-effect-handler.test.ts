import { describe, expect, it, vi } from 'vitest';
import { applyCommandEffects } from '../hooks/command-effect-handler.js';

function createDeps() {
  return {
    addEntry: vi.fn(),
    requestShutdown: vi.fn(),
    requestModelChange: vi.fn(),
    openPluginTUI: vi.fn(),
    openSessionPicker: vi.fn(),
    renameSession: vi.fn(),
    applyStatusLinePatch: vi.fn(),
  };
}

describe('applyCommandEffects', () => {
  it('applies session rename effects through the UI dependency boundary', () => {
    const deps = createDeps();

    const handled = applyCommandEffects(
      [{ type: 'session-renamed', name: 'my-session' }],
      {},
      deps,
    );

    expect(handled).toBe(true);
    expect(deps.renameSession).toHaveBeenCalledWith('my-session');
    expect(deps.requestShutdown).not.toHaveBeenCalled();
  });

  it('applies session picker effects through the UI dependency boundary', () => {
    const deps = createDeps();

    const handled = applyCommandEffects([{ type: 'session-picker-requested' }], {}, deps);

    expect(handled).toBe(true);
    expect(deps.openSessionPicker).toHaveBeenCalledTimes(1);
    expect(deps.requestShutdown).not.toHaveBeenCalled();
  });
});
