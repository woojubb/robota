import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { embeddedProductIdentity, resolveProductConfig } from './index.js';
import { productEnvironment } from './__tests__/product-environment.js';
import { loadProductConfig, loadProductConfigSelection, parseProductEnvironmentFile } from './node.js';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe('explicit Node product loader', () => {
  it('loads only a selected temporary file and resolves paths against its directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'product-config-'));
    temporary.push(directory);
    const filePath = join(directory, '.env');
    const file = { ...productEnvironment(), PRODUCT_USER_STATE_DIR: './user', PRODUCT_CACHE_DIR: './cache', PRODUCT_LOG_DIR: './logs' };
    writeFileSync(filePath, Object.entries(file).map(([key, value]) => `${key}=${value}`).join('\n'));
    const readFile = vi.fn((path: string) => readFileSync(path, 'utf8'));
    const result = loadProductConfig({ filePath, environment: { PRODUCT_USER_STATE_DIR: '../runtime-user' }, readFile });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(filePath);
    expect(result.storage.userRoot).toBe(join(directory, '..', 'runtime-user'));
    expect(result.storage.cacheRoot).toBe(join(directory, 'cache'));
    expect(result.storage.projectDirectory).toBe('.cedar');
    expect(Object.isFrozen(result.storage)).toBe(true);
  });

  it('does no file IO unless a caller selects a file and does not cache selected values', () => {
    const readFile = vi.fn(() => 'PRODUCT_DISPLAY_NAME=File Agent');
    expect(loadProductConfig({ environment: productEnvironment(), readFile }).identity.displayName).toBe('cedar Agent');
    expect(readFile).not.toHaveBeenCalled();
    expect(() => loadProductConfig({ environment: {}, readFile })).toThrow('PRODUCT_ENV_PREFIX');
    expect(readFile).not.toHaveBeenCalled();
    const filePath = join(tmpdir(), 'synthetic-config.env');
    const first = loadProductConfig({ filePath, defaults: productEnvironment(), environment: {}, readFile });
    readFile.mockReturnValue('PRODUCT_DISPLAY_NAME=Changed Agent');
    const second = loadProductConfig({ environment: { PRODUCT_CONFIG_FILE: filePath }, defaults: productEnvironment(), readFile });
    expect(first.identity.displayName).toBe('File Agent');
    expect(second.identity.displayName).toBe('Changed Agent');
  });

  it('returns the selected operational values from the same single file read', () => {
    const filePath = join(tmpdir(), 'selected-product.env');
    const readFile = vi.fn(() => `${Object.entries(productEnvironment()).map(([key, value]) => `${key}=${value}`).join('\n')}\nANTHROPIC_API_KEY=synthetic-file-key\n`);
    const selection = loadProductConfigSelection({ filePath, environment: {}, readFile });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(selection.config.identity.id).toBe('cedar');
    expect(selection.fileValues.ANTHROPIC_API_KEY).toBe('synthetic-file-key');
    expect(Object.isFrozen(selection.fileValues)).toBe(true);
    expect(Object.isFrozen(selection)).toBe(true);
  });

  it('refuses relative unanchored paths and file selection conflicts without reading private values', () => {
    const readFile = vi.fn(() => 'unused');
    expect(() => loadProductConfig({ environment: productEnvironment(), filePath: '.env', readFile })).toThrow('PRODUCT_CONFIG_FILE');
    expect(() => loadProductConfig({ environment: { ...productEnvironment(), PRODUCT_CONFIG_FILE: '/tmp/a.env' }, filePath: '/tmp/b.env', readFile })).toThrow('conflicts');
    expect(() => loadProductConfig({ environment: { ...productEnvironment(), PRODUCT_USER_STATE_DIR: './user' }, readFile })).toThrow('PRODUCT_USER_STATE_DIR');
    expect(readFile).not.toHaveBeenCalled();
    const sentinel = 'synthetic-reader-secret';
    expect(() => loadProductConfig({ environment: productEnvironment(), filePath: '/tmp/config.env', readFile: () => { throw new Error(sentinel); } })).toThrow('could not be loaded');
    try {
      loadProductConfig({ environment: productEnvironment(), filePath: '/tmp/config.env', readFile: () => { throw new Error(sentinel); } });
    } catch (error) {
      expect(String(error)).not.toContain(sentinel);
    }
  });

  it('does not read a foreign ambient config selector for an installed product', () => {
    const defaults = productEnvironment('cedar');
    const readFile = vi.fn(() => 'unread');
    const embeddedIdentity = embeddedProductIdentity(
      resolveProductConfig({ environment: defaults }),
    );
    const config = loadProductConfig({
      environment: { PRODUCT_ID: 'amber', PRODUCT_CONFIG_FILE: '/tmp/foreign.env' },
      defaults,
      embeddedIdentity,
      readFile,
    });
    expect(config.identity.id).toBe('cedar');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('parses quoting and comments without variable expansion', () => {
    const values = parseProductEnvironmentFile('# comment\nexport PRODUCT_DISPLAY_NAME="Example Agent"\nANTHROPIC_API_KEY=\'literal/$VARIABLE.key\'\nPRODUCT_ID=cedar # inline comment');
    expect(values['PRODUCT_DISPLAY_NAME']).toBe('Example Agent');
    expect(values['PRODUCT_ID']).toBe('cedar');
    expect(values['ANTHROPIC_API_KEY']).toBe('literal/$VARIABLE.key');
    expect(Object.isFrozen(values)).toBe(true);
    expect(parseProductEnvironmentFile("PRODUCT_DISPLAY_NAME=Alice's Agent # comment\nPRODUCT_ID=cedar")).toEqual({ PRODUCT_DISPLAY_NAME: "Alice's Agent", PRODUCT_ID: 'cedar' });
    expect(parseProductEnvironmentFile('PRODUCT_DISPLAY_NAME="Line # one\nLine two" # ignored\nPRODUCT_ID=cedar').PRODUCT_DISPLAY_NAME).toBe('Line # one\nLine two');
  });
});
