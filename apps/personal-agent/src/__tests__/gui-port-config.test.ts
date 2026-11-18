import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig, saveConfig } from '../config.js';
import { boundGuiPort, loadGuiPort, saveGuiPort } from '../gui-port.js';

describe('the remembered GUI port', () => {
  it('keeps the default HTTP port when URL normalization omits it', () => {
    expect(boundGuiPort(80, 'http://127.0.0.1/')).toBe(80);
    expect(boundGuiPort(0, 'http://127.0.0.1/')).toBe(80);
    expect(boundGuiPort(0, 'http://127.0.0.1:40000/')).toBe(40000);
  });
  it('preserves provider settings, refuses invalid ports, and keeps a concurrent first choice', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'personal-port-'));
    try {
      const profile = { type: 'openai', model: 'example' };
      saveConfig(stateDir, { version: 1, provider: profile });
      expect(loadGuiPort(stateDir)).toBeUndefined();
      expect(saveGuiPort(stateDir, 40000, false)).toBe(40000);
      expect(saveGuiPort(stateDir, 40001, false)).toBe(40000);
      expect(loadGuiPort(stateDir)).toBe(40000);
      expect(saveGuiPort(stateDir, 40001, true)).toBe(40001);
      expect(loadGuiPort(stateDir)).toBe(40001);
      expect(loadConfig(stateDir)).toEqual({ version: 1, provider: profile });
      expect(() => saveGuiPort(stateDir, 0, true)).toThrow(/GUI port is invalid/u);
      expect(loadGuiPort(stateDir)).toBe(40001);
      for (const guiPort of ['-1', '0', '65536', '1.5', '']) {
        writeFileSync(join(stateDir, 'gui-port'), guiPort);
        expect(() => loadGuiPort(stateDir)).toThrow(/saved GUI port is invalid/u);
      }
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
