import { describe, expect, it } from 'vitest';

import {
  buildMemorySessionOptions,
  DEFAULT_MEMORY_BUDGET,
  printMemoryEnableNoticeOnce,
  readMemorySettings,
  resetMemoryEnableNoticeForTests,
  resolveMemoryEnablement,
} from '../memory-enablement.js';

describe('resolveMemoryEnablement — SELFHOST-008 P6', () => {
  describe('TC-01: default OFF', () => {
    it('is OFF with no settings, flag, or env', () => {
      expect(resolveMemoryEnablement({})).toEqual({ enabled: false, autoSave: false });
    });

    it('injects NO memory options when disabled (empty object)', () => {
      const options = buildMemorySessionOptions({ enabled: false, autoSave: false }, '/repo');
      expect(options).toEqual({});
    });
  });

  describe('TC-02: settings ← flag ← env precedence', () => {
    it('settings.json memory.enabled is the SSOT', () => {
      expect(resolveMemoryEnablement({ settings: { enabled: true } }).enabled).toBe(true);
      expect(resolveMemoryEnablement({ settings: { enabled: false } }).enabled).toBe(false);
    });

    it('--memory / --no-memory overrides the setting', () => {
      // flag ON overrides settings OFF
      expect(
        resolveMemoryEnablement({ settings: { enabled: false }, flagEnabled: true }).enabled,
      ).toBe(true);
      // flag OFF overrides settings ON
      expect(
        resolveMemoryEnablement({ settings: { enabled: true }, flagEnabled: false }).enabled,
      ).toBe(false);
    });

    it('ROBOTA_MEMORY=1|0 wins over both settings and flag', () => {
      expect(
        resolveMemoryEnablement({ settings: { enabled: false }, flagEnabled: false, env: '1' })
          .enabled,
      ).toBe(true);
      expect(
        resolveMemoryEnablement({ settings: { enabled: true }, flagEnabled: true, env: '0' })
          .enabled,
      ).toBe(false);
    });

    it('ignores an unrecognized ROBOTA_MEMORY value (falls through to flag/settings)', () => {
      expect(resolveMemoryEnablement({ settings: { enabled: true }, env: 'yes' }).enabled).toBe(
        true,
      );
      expect(resolveMemoryEnablement({ env: '' }).enabled).toBe(false);
    });

    it('autoSave = settings.autoSave OR --memory-autosave', () => {
      expect(resolveMemoryEnablement({ settings: { autoSave: true } }).autoSave).toBe(true);
      expect(resolveMemoryEnablement({ flagAutoSave: true }).autoSave).toBe(true);
      expect(resolveMemoryEnablement({}).autoSave).toBe(false);
    });
  });

  describe('TC-03: injection when enabled', () => {
    it('carries memoryStore + recallMemory + automaticMemory with the default budget', () => {
      const options = buildMemorySessionOptions({ enabled: true, autoSave: false }, '/repo');
      expect(options.memoryStore).toBeDefined();
      expect(options.recallMemory).toEqual({ budget: DEFAULT_MEMORY_BUDGET });
      expect(options.automaticMemory).toEqual({
        policy: 'approval_required',
        retrieval: DEFAULT_MEMORY_BUDGET,
      });
    });

    it('defaults policy to approval_required, flips to auto_save when opted in', () => {
      expect(
        buildMemorySessionOptions({ enabled: true, autoSave: true }, '/repo').automaticMemory
          ?.policy,
      ).toBe('auto_save');
      expect(
        buildMemorySessionOptions({ enabled: true, autoSave: false }, '/repo').automaticMemory
          ?.policy,
      ).toBe('approval_required');
    });
  });

  describe('readMemorySettings', () => {
    it('parses the enabled/autoSave booleans from a raw settings record', () => {
      expect(readMemorySettings({ memory: { enabled: true, autoSave: true } })).toEqual({
        enabled: true,
        autoSave: true,
      });
    });

    it('returns undefined for absent or malformed entries', () => {
      expect(readMemorySettings({})).toBeUndefined();
      expect(readMemorySettings(undefined)).toBeUndefined();
      expect(readMemorySettings({ memory: 'on' })).toBeUndefined();
      expect(readMemorySettings({ memory: [true] })).toBeUndefined();
    });

    it('ignores non-boolean fields without throwing', () => {
      expect(readMemorySettings({ memory: { enabled: 'yes', autoSave: 1 } })).toEqual({});
    });
  });

  describe('printMemoryEnableNoticeOnce (TC-07 notice)', () => {
    it('prints once per process, then is a no-op', () => {
      resetMemoryEnableNoticeForTests();
      const lines: string[] = [];
      printMemoryEnableNoticeOnce('/repo', (m) => lines.push(m));
      printMemoryEnableNoticeOnce('/repo', (m) => lines.push(m));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('Memory is ON');
      expect(lines[0]).toContain('/memory');
    });
  });
});
