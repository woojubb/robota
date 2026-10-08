import { afterEach, describe, expect, it, vi } from 'vitest';
const logger = vi.hoisted(() => ({ setGlobalLoggerSink: vi.fn() }));
vi.mock('@robota-sdk/agent-core', () => logger);
import { installCliDiagnostics } from '../bootstrap-diagnostics.js';
afterEach(() => vi.restoreAllMocks());

describe('configured CLI diagnostics', () => {
  it('uses the configured brand for structured runtime warnings', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installCliDiagnostics('cedar');
    const sink = logger.setGlobalLoggerSink.mock.calls.at(-1)![0];
    sink.warn('fixture warning', { outcome: 'unknown' });
    expect(stderr).toHaveBeenCalledWith('[cedar] fixture warning outcome=unknown');
  });
});
