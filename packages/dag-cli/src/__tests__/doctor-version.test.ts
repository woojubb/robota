import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withTempWorkspace } from '../utils/temp-workspace.js';

const sourceUrl = new URL('../commands/doctor.ts', import.meta.url);
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

function runSourceDoctor(cwd: string, args: string[]): string {
  return execFileSync(
    process.execPath,
    [
      '--import',
      loader,
      '--input-type=module',
      '--eval',
      `import { doctorCommand } from ${JSON.stringify(sourceUrl.href)};
const code = await doctorCommand(${JSON.stringify(args)}, {
  cwd: process.cwd(),
  io: {
    write: text => process.stdout.write(text),
    writeError: text => process.stderr.write(text),
    readTextFile: async () => { throw new Error('unexpected workflow read'); },
    writeBinaryStream: async () => { throw new Error('unexpected binary write'); },
  },
});
if (code !== 1) throw new Error('expected missing-configuration diagnostic exit 1');`,
    ],
    { cwd, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 15000 },
  );
}

describe('doctor owner-local version', () => {
  it('reports the embedded version from the actual physical built binary', async () => {
    const bin = realpathSync(new URL('../../dist/node/bin.js', import.meta.url));
    await withTempWorkspace('dag-doctor-built-version', async (temporary) => {
      const cwd = realpathSync(temporary);
      const result = spawnSync(
        process.execPath,
        [bin, 'doctor'],
        {
          cwd,
          env: { PATH: process.env.PATH ?? '', ROBOTA_DAG_TELEMETRY: '0' },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(`✓ dag-cli v${manifest.version}\n`);
      expect(result.stdout).toContain('OPENAI_API_KEY not set');
    });
  });

  it('reports the owner version from actual source without credentials or user cwd', async () => {
    await withTempWorkspace('dag-doctor-version', async (cwd) => {
      const output = runSourceDoctor(cwd, []);
      expect(output).toContain(`✓ dag-cli v${manifest.version}\n`);
      expect(output).toContain('.dag/ directory not found');
      expect(output).toContain('ANTHROPIC_API_KEY not set');
      expect(output).toContain('OPENAI_API_KEY not set');
    });
  });

  it('preserves JSON diagnostics in the same credential-free execution', async () => {
    await withTempWorkspace('dag-doctor-version-json', async (cwd) => {
      const output = JSON.parse(runSourceDoctor(cwd, ['--json']));
      expect(output).toMatchObject({ ok: false, errorCount: 4, warningCount: 2 });
      expect(output).not.toHaveProperty('version');
    });
  });
});
