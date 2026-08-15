import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SESSION_LOG_EVENT } from '../session-log-events.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SOURCE_ROOTS = [
  join(PACKAGE_ROOT, 'agent-core', 'src'),
  join(PACKAGE_ROOT, 'agent-session', 'src'),
  join(PACKAGE_ROOT, 'agent-framework', 'src'),
];

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'examples' || entry.name === 'fixtures')
        return [];
      return productionTypeScriptFiles(path);
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts'))
      return [];
    return [path];
  });
}

function collectSessionLogEventLiterals(): string[] {
  const events = new Set<string>();
  const patterns = [
    /(?:this|ctx|enforcer)\.log\(\s*'([^']+)'/g,
    /logger\.log\([^,]+,\s*'([^']+)'/g,
    /onExecutionEvent\?\.\(\s*'([^']+)'/g,
    /entry\.event\s*===\s*'([^']+)'/g,
  ];

  for (const root of SOURCE_ROOTS) {
    for (const file of productionTypeScriptFiles(root)) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) events.add(match[1]);
      }
    }
  }
  return [...events].sort();
}

describe('SESSION_LOG_EVENT production vocabulary', () => {
  it('classifies every direct logger, execution event, and replay-reader literal', () => {
    const declared = new Set<string>(Object.values(SESSION_LOG_EVENT));
    const unrecognized = collectSessionLogEventLiterals().filter((event) => !declared.has(event));

    expect(unrecognized).toEqual([]);
  });
});
