import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { UnsupportedShellError } from '@robota-sdk/agent-core';

import { resolveProductShellExecutable } from '../shell.js';
import {
  createProductPackSet,
  createProductSubagentComposition,
} from '../subagent-composition.js';

/** Roots sit, unmade, in one private per-run directory rather than at a fixed name under /tmp. */
const PRIVATE_BASE = mkdtempSync(join(tmpdir(), 'test-product-shell-test-'));
afterAll(() => rmSync(PRIVATE_BASE, { recursive: true, force: true }));

describe('test-product Agent shell policy', () => {
  it('selects a validated explicit executable from PRODUCT_SHELL', () => {
    expect(resolveProductShellExecutable({ PRODUCT_SHELL: '  /bin/bash  ' })).toBe('/bin/bash');
    expect(resolveProductShellExecutable({ PRODUCT_SHELL: '   ' })).toBeUndefined();
  });

  it('fails closed for an unsupported override', () => {
    expect(() => resolveProductShellExecutable({ PRODUCT_SHELL: '/bin/fish' })).toThrow(
      UnsupportedShellError,
    );
  });

  it('passes the choice through the parent coding pack', () => {
    const shellExecutable = resolveProductShellExecutable({ PRODUCT_SHELL: '/bin/bash' });
    const { packs } = createProductPackSet(join(PRIVATE_BASE, 'parent'), createTestProductRuntime(), { shellExecutable });
    const shell = packs
      .flatMap((pack) => pack.tools ?? [])
      .find((tool) => tool.getName() === 'Shell');
    expect(shell?.getDescription()).toContain('bash on');
  });

  it('rebuilds the child tool and hook choices from test-product Agent policy', () => {
    const previous = process.env['PRODUCT_SHELL'];
    process.env['PRODUCT_SHELL'] = '/bin/bash';
    try {
      const composition = createProductSubagentComposition(createTestProductRuntime('test-product', { PRODUCT_SHELL: '/bin/bash' }));
      const shell = composition
        .createTools({ cwd: join(PRIVATE_BASE, 'child') })
        .find((tool) => tool.getName() === 'Shell');
      expect(shell?.getDescription()).toContain('bash on');
      expect(composition.createHookTypeExecutors?.({ cwd: join(PRIVATE_BASE, 'child') }).map((executor) => executor.type)).toEqual([
        'command',
        'http',
      ]);
    } finally {
      if (previous === undefined) delete process.env['PRODUCT_SHELL'];
      else process.env['PRODUCT_SHELL'] = previous;
    }
  });
});
