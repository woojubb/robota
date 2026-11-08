import { afterEach, describe, expect, it, vi } from 'vitest';
import { warnIfTerminalAppOnMacOS } from '../terminal-check.js';
import { createCapturingTerminal } from './test-terminal.js';

function stubPlatform(platform: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  return () => {
    if (original) Object.defineProperty(process, 'platform', original);
  };
}

describe('warnIfTerminalAppOnMacOS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('warns on darwin + Apple_Terminal', () => {
    const restore = stubPlatform('darwin');
    vi.stubEnv('TERM_PROGRAM', 'Apple_Terminal');
    const { terminal, errors } = createCapturingTerminal();
    warnIfTerminalAppOnMacOS(terminal, { TERM_PROGRAM: process.env['TERM_PROGRAM'] });
    restore();
    expect(errors.join('\n')).toContain('Terminal.app');
  });

  it('silent on darwin + iTerm', () => {
    const restore = stubPlatform('darwin');
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    const { terminal, errors } = createCapturingTerminal();
    warnIfTerminalAppOnMacOS(terminal, { TERM_PROGRAM: process.env['TERM_PROGRAM'] });
    restore();
    expect(errors).toHaveLength(0);
  });

  it('silent on non-darwin platforms', () => {
    const restore = stubPlatform('linux');
    vi.stubEnv('TERM_PROGRAM', 'Apple_Terminal');
    const { terminal, errors } = createCapturingTerminal();
    warnIfTerminalAppOnMacOS(terminal, { TERM_PROGRAM: process.env['TERM_PROGRAM'] });
    restore();
    expect(errors).toHaveLength(0);
  });
});
