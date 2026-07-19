import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * TC-06 (neutrality): `agent-tools`' computer-use carries the driver PORT + a zero-dep reference adapter
 * that DUCK-TYPES a page — never a heavy browser SDK and never a concrete target (URL/host). This asserts
 * the invariant mechanically over the shipped `computer-use/` source (excluding tests).
 */

const COMPUTER_USE_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Heavy browser-automation SDKs that must NEVER be imported by the neutral library. */
const FORBIDDEN_IMPORTS = [
  'playwright',
  'playwright-core',
  'puppeteer',
  'puppeteer-core',
  'chrome-remote-interface',
  'webdriverio',
  'selenium-webdriver',
  '@e2b',
];

/** A concrete target must never be baked into the library — the surface supplies it. */
const FORBIDDEN_TARGET = /https?:\/\//i;

function collectShippedFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      files.push(...collectShippedFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('computer-use neutrality (TC-06)', () => {
  const files = collectShippedFiles(COMPUTER_USE_DIR);

  it('ships source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports no heavy browser SDK', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const importLines = source
        .split('\n')
        .filter((line) => /\b(import|require)\b/.test(line) && /from\s+['"]|require\(/.test(line));
      for (const forbidden of FORBIDDEN_IMPORTS) {
        for (const line of importLines) {
          expect(line, `${file} must not import ${forbidden}`).not.toContain(`'${forbidden}`);
          expect(line, `${file} must not import ${forbidden}`).not.toContain(`"${forbidden}`);
        }
      }
    }
  });

  it('bakes in no concrete target URL/host', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Strip comments so doc examples referencing a scheme do not count.
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
        .join('\n');
      expect(FORBIDDEN_TARGET.test(withoutComments), `${file} must not bake in a target URL`).toBe(
        false,
      );
    }
  });
});
