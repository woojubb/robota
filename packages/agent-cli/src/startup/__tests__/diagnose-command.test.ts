import { describe, expect, it } from 'vitest';
import { runDiagnoseCommand } from '../diagnose-command.js';
import type { IDiagnosticCheck } from '../diagnose-command.js';
import { createCapturingTerminal } from './test-terminal.js';

const stubNetworkCheck = (): Promise<IDiagnosticCheck> =>
  Promise.resolve({ label: 'Network (stub)', status: 'ok', message: 'reachable (1ms)' });

describe('runDiagnoseCommand', () => {
  it('TC-02: prints all six diagnostic check labels and a summary line', async () => {
    const { terminal, lines } = createCapturingTerminal();
    await runDiagnoseCommand(
      { version: '3.0.0-test', terminal, cwd: process.cwd() },
      { checkNetwork: stubNetworkCheck },
    );
    const output = lines.join('\n');
    expect(output).toContain('Node.js version');
    expect(output).toContain('robota version');
    expect(output).toContain('API key');
    expect(output).toContain('Settings file');
    expect(output).toContain('Terminal');
    expect(output).toContain('Network');
    expect(output).toMatch(/All checks passed|issue\(s\) found|warning\(s\)/);
  });

  it('reports the provided CLI version', async () => {
    const { terminal, lines } = createCapturingTerminal();
    await runDiagnoseCommand(
      { version: '9.9.9-marker', terminal, cwd: process.cwd() },
      { checkNetwork: stubNetworkCheck },
    );
    expect(lines.join('\n')).toContain('9.9.9-marker');
  });
});
