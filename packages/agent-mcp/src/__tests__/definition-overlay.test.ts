/**
 * TC-09 — reversible disable overlays.
 *
 * "Reversible" is the property under test: a disabled entry is still listed with its provenance, so
 * re-enabling restores the identical resolved entry because nothing was removed to restore.
 */

import { describe, expect, it } from 'vitest';

import {
  applyDisableOverlay,
  clearDisable,
  isDisabled,
  MCPOverlayError,
} from '../definition/overlay.js';

import type { IMCPResolvedEntry } from '../definition/types.js';

const entry = (name: string): IMCPResolvedEntry => ({
  name,
  source: 'project',
  origin: '.mcp.json',
  status: 'resolved',
  definition: {
    name,
    source: 'project',
    origin: '.mcp.json',
    transport: 'stdio',
    command: 'server',
    unsetVariables: [],
  },
  shadowed: [],
});

describe('applyDisableOverlay', () => {
  it('keeps a disabled entry listed, with its provenance and a stated reason', () => {
    const [alpha] = applyDisableOverlay([entry('alpha')], {
      disabled: { alpha: 'paused while the vendor investigates' },
    });

    expect(alpha!.name).toBe('alpha');
    expect(alpha!.source).toBe('project');
    expect(alpha!.origin).toBe('.mcp.json');
    expect(alpha!.definition?.command).toBe('server');
    expect(alpha!.disabledReason).toBe('paused while the vendor investigates');
    expect(isDisabled(alpha!)).toBe(true);
  });

  it('restores the identical entry when the overlay is cleared', () => {
    const original = entry('alpha');
    const [disabled] = applyDisableOverlay([original], { disabled: { alpha: 'paused' } });
    expect(clearDisable(disabled!)).toEqual(original);
  });

  it('leaves entries the overlay does not name untouched', () => {
    const entries = [entry('alpha'), entry('beta')];
    const applied = applyDisableOverlay(entries, { disabled: { alpha: 'paused' } });

    expect(isDisabled(applied[0]!)).toBe(true);
    expect(isDisabled(applied[1]!)).toBe(false);
    expect(applied[1]).toEqual(entries[1]);
  });

  it('refuses an overlay naming a server that does not exist', () => {
    // A typo that reads as a successful disable is discovered when the server keeps running.
    expect(() => applyDisableOverlay([entry('alpha')], { disabled: { alpah: 'typo' } })).toThrow(
      MCPOverlayError,
    );
    expect(() => applyDisableOverlay([entry('alpha')], { disabled: { alpah: 'typo' } })).toThrow(
      /cannot disable unknown MCP server\(s\): alpah.*Known: alpha/s,
    );
  });

  it('can disable an unresolved entry, which is still a name the operator can see', () => {
    const unresolved: IMCPResolvedEntry = {
      name: 'beta',
      source: 'managed',
      origin: 'policy.json',
      status: 'unresolved',
      shadowed: [],
    };
    const [applied] = applyDisableOverlay([unresolved], { disabled: { beta: 'broken anyway' } });
    expect(applied!.disabledReason).toBe('broken anyway');
  });

  it('is a no-op for an empty overlay, with or without the disabled map', () => {
    const entries = [entry('alpha')];
    expect(applyDisableOverlay(entries, { disabled: {} })).toEqual(entries);
    // `{}` is how a caller says "nothing is disabled"; it threw a TypeError until the MCP-001
    // scenario ran and hit it.
    expect(applyDisableOverlay(entries, {})).toEqual(entries);
  });
});
