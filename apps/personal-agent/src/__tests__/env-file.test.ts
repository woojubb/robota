import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  editorCommand,
  ensureEnvFile,
  envFilePath,
  parseEnvFile,
  shellQuote,
  withEnvFile,
} from '../env-file.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-env-'));
  dirs.push(dir);
  return dir;
}

describe('the owner .env', () => {
  it('reads NAME=value lines and skips comments, blanks and malformed lines', () => {
    expect(
      parseEnvFile(
        [
          '# a comment',
          'AI_GATEWAY_API_KEY=abc123',
          'OPENAI_API_KEY=',
          'export QUOTED="with spaces"',
          "SINGLE='x=y'",
          'not a line',
          '1BAD=nope',
          '',
        ].join('\r\n'),
      ),
    ).toEqual({ AI_GATEWAY_API_KEY: 'abc123', QUOTED: 'with spaces', SINGLE: 'x=y' });
  });

  it('is created once, owner-only, with a template that names the key variables', () => {
    const dir = stateDir();
    const path = ensureEnvFile(dir);
    expect(path).toBe(envFilePath(dir));
    expect(readFileSync(path, 'utf8')).toContain('AI_GATEWAY_API_KEY=');
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    writeFileSync(path, 'AI_GATEWAY_API_KEY=kept\n');
    ensureEnvFile(dir);
    expect(readFileSync(path, 'utf8')).toBe('AI_GATEWAY_API_KEY=kept\n');
  });

  it('fills the environment from the file, and a variable already set wins', () => {
    const dir = stateDir();
    ensureEnvFile(dir);
    writeFileSync(envFilePath(dir), 'AI_GATEWAY_API_KEY=from-file\nOPENAI_API_KEY=from-file\n');
    const merged = withEnvFile(dir, { OPENAI_API_KEY: 'from-process', AI_GATEWAY_API_KEY: '' });
    expect(merged['AI_GATEWAY_API_KEY']).toBe('from-file');
    expect(merged['OPENAI_API_KEY']).toBe('from-process');
    expect(withEnvFile(stateDir(), { A: '1' })).toEqual({ A: '1' });
  });

  it.skipIf(process.platform === 'win32')('refuses a key file other users can read', () => {
    const dir = stateDir();
    const path = ensureEnvFile(dir);
    chmodSync(path, 0o644);
    expect(() => withEnvFile(dir, {})).toThrow(/chmod 600/u);
  });

  it.skipIf(process.platform === 'win32')(
    'quotes a path so the shell takes $, backticks and quotes literally',
    () => {
      for (const path of ['/s/a$HOME/.env', '/s/a`echo x`/.env', "/s/it's/.env", '/s/a b/.env']) {
        const echoed = spawnSync(`printf %s ${shellQuote(path, 'linux')}`, {
          shell: true,
          encoding: 'utf8',
        });
        expect(echoed.stdout).toBe(path);
      }
    },
  );

  it("opens the person's editor first, else the system's text editor", () => {
    expect(editorCommand('/s/.env', { EDITOR: 'code --wait' }, 'linux')).toEqual({
      command: "code --wait '/s/.env'",
      args: [],
      shell: true,
    });
    expect(editorCommand('/s/.env', { VISUAL: 'vim', EDITOR: 'nano' }, 'linux').command).toBe(
      "vim '/s/.env'",
    );
    expect(editorCommand('/s/.env', {}, 'darwin')).toEqual({
      command: 'open',
      args: ['-t', '/s/.env'],
      shell: false,
    });
    expect(editorCommand('C:\\s\\.env', {}, 'win32').command).toBe('notepad');
    expect(editorCommand('/s/.env', {}, 'linux').command).toBe('xdg-open');
  });
});
