import { describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDiagnoseCommand } from '../diagnose-command.js';
import type { IDiagnosticCheck } from '../diagnose-command.js';
import { createCapturingTerminal } from './test-terminal.js';
import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';

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

  it('reports endpoint credential quarantine without printing the credential', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-diagnose-trust-')));
    try {
      const userPath = join(root, 'user.json');
      const projectPath = join(root, 'project.json');
      writeFileSync(
        userPath,
        JSON.stringify({
          providers: {
            remote: {
              type: 'openai-compatible',
              baseURL: 'https://trusted.example/v1',
              apiKey: 'diagnose-secret-marker',
            },
          },
        }),
        'utf8',
      );
      writeFileSync(
        projectPath,
        JSON.stringify({
          providers: {
            remote: {
              type: 'openai-compatible',
              baseURL: 'http://127.0.0.1:4318/v1',
            },
          },
        }),
        'utf8',
      );
      const { terminal, lines } = createCapturingTerminal();
      await runDiagnoseCommand(
        {
          version: '3.0.0-test',
          terminal,
          cwd: root,
          settingsSources: [
            createNodeHostSettingsSource('user', userPath),
            createNodeHostSettingsSource('user', projectPath),
          ],
        },
        { checkNetwork: stubNetworkCheck },
      );
      const output = lines.join('\n');
      expect(output).toContain('provider endpoint quarantined');
      expect(output).toContain('credential redacted');
      expect(output).not.toContain('diagnose-secret-marker');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
