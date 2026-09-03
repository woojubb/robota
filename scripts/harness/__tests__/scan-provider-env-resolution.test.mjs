import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findAmbientEnvReads, NORMALIZATION_MODULES } from '../scan-provider-env-resolution.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-provider-env-resolution.mjs', import.meta.url));
const WORKSPACE_ROOT = path.resolve(path.dirname(SCAN_SCRIPT), '../..');

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'provider-env-resolution-'));
  for (const [relative, source] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  return root;
}

describe('scan-provider-env-resolution (#2347)', () => {
  it('finds a bare process.env read in a normalization module, with its line', () => {
    const root = fixture({
      'mod/a.ts': "const key = process.env.OPENAI_API_KEY;\nconst other = process . env['X'];\n",
    });
    expect(findAmbientEnvReads(root, ['mod/a.ts'])).toEqual([
      { file: 'mod/a.ts', line: 1, text: 'const key = process.env.OPENAI_API_KEY;' },
      { file: 'mod/a.ts', line: 2, text: "const other = process . env['X'];" },
    ]);
  });

  it('does not count a comment that merely names the forbidden read', () => {
    const root = fixture({
      'mod/a.ts': [
        '// never read process.env here',
        ' * process.env is resolved through TEnvResolver',
        'const x = resolver.get("KEY"); /* not process.env */',
        '',
      ].join('\n'),
    });
    expect(findAmbientEnvReads(root, ['mod/a.ts'])).toEqual([]);
  });

  it('reads every configured module, and the live normalization modules are clean', () => {
    expect(NORMALIZATION_MODULES.length).toBeGreaterThan(0);
    expect(findAmbientEnvReads(WORKSPACE_ROOT)).toEqual([]);
  });

  it('exits 0 on the live repository and says what it examined', () => {
    const output = execFileSync(process.execPath, [SCAN_SCRIPT], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    });
    expect(output).toContain(
      `::examined:: ${NORMALIZATION_MODULES.length} normalization module(s)`,
    );
    expect(output).toContain('provider-env-resolution: no normalization module reads process.env');
  });
});
