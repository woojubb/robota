import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderDoctorReport } from '../doctor-render.js';
import { applyDoctorRepair, planDoctorRepair } from '../doctor-repair.js';
import { runDoctor } from '../doctor-runner.js';
import { settingsCheckId } from '../doctor-settings-probe.js';
import { createDoctorFixture } from './doctor-fixture.js';

import type { IHostSettingsSource } from '@robota-sdk/agent-framework';
import type { IDoctorFixture } from './doctor-fixture.js';
import type { IDoctorReport } from '../doctor-types.js';

/**
 * A host settings source need not be a file: a browser host reads its settings from its own
 * storage and has no `path`. The doctor still has to give each such layer its own `--repair` id,
 * name it, and never offer to rewrite it.
 */
const fixtures: IDoctorFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function pathlessSource(
  displayName: string,
  text: string | undefined,
  scope: 'user' | 'managed' = 'user',
): IHostSettingsSource {
  return Object.freeze({ kind: 'host' as const, scope, displayName, read: () => text });
}

function byId(report: IDoctorReport, id: string) {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (check === undefined)
    throw new Error(`no check ${id}; have ${report.checks.map((c) => c.id).join(', ')}`);
  return check;
}

function withPathlessLayers(): { fixture: IDoctorFixture; sources: IHostSettingsSource[] } {
  const fixture = createDoctorFixture({ env: {} });
  fixtures.push(fixture);
  const sources = [
    pathlessSource('In-memory settings', '   '),
    pathlessSource('Browser storage', '{ not json'),
    pathlessSource('Managed policy', '{"language":"ko"}', 'managed'),
  ];
  return { fixture, sources };
}

describe('settings layers that are not files', () => {
  it('gives each layer an id from a slug of its display name, never an empty family', () => {
    expect(settingsCheckId(pathlessSource('In-memory settings', undefined))).toBe(
      'settings.user.in-memory-settings',
    );
    expect(settingsCheckId(pathlessSource('  Browser storage (IndexedDB) ', undefined))).toBe(
      'settings.user.browser-storage-indexeddb',
    );
    expect(settingsCheckId(pathlessSource('Managed policy', undefined, 'managed'))).toBe(
      'settings.managed.managed-policy',
    );
    expect(settingsCheckId(pathlessSource('', undefined))).toBe('settings.user.unnamed');
    expect(settingsCheckId(pathlessSource('***', undefined))).toBe('settings.user.unnamed');
  });

  it('reports two such layers under distinct ids, named by label, with no path', async () => {
    const { fixture, sources } = withPathlessLayers();

    const report = await runDoctor({ ...fixture.inputs, settingsSources: sources }, fixture.deps);

    const empty = byId(report, 'settings.user.in-memory-settings');
    const corrupt = byId(report, 'settings.user.browser-storage');
    const ok = byId(report, 'settings.managed.managed-policy');
    expect(empty).toMatchObject({
      label: 'Settings layer (In-memory settings)',
      status: 'fail',
      cause: 'empty',
    });
    expect(corrupt).toMatchObject({
      label: 'Settings layer (Browser storage)',
      status: 'fail',
    });
    expect(ok).toMatchObject({ label: 'Settings layer (Managed policy)', status: 'ok' });
    for (const check of [empty, corrupt, ok]) {
      expect(check.path).toBeUndefined();
      expect('path' in check).toBe(false);
    }
    expect(empty.detail?.join(' ')).toContain('Fix the document the host names');
    expect(empty.detail?.join(' ')).not.toContain('named path');
    const output = renderDoctorReport(report).join('\n');
    expect(output).toContain(
      'Settings layer (In-memory settings) [settings.user.in-memory-settings]',
    );
    expect(output).not.toMatch(/path: undefined/);
  });

  it('offers no repair for them, even when one is empty', async () => {
    const { fixture, sources } = withPathlessLayers();
    const inputs = { ...fixture.inputs, settingsSources: sources };

    const report = await runDoctor(inputs, fixture.deps);

    expect(byId(report, 'settings.user.in-memory-settings').repair).toBeUndefined();
    expect(byId(report, 'settings.user.browser-storage').repair).toBeUndefined();
    expect(report.repairable).not.toContain('settings.user.in-memory-settings');
    expect(report.repairable).not.toContain('settings.user.browser-storage');
  });

  it('refuses a repair named by their id and writes nothing', async () => {
    const { fixture, sources } = withPathlessLayers();
    const inputs = { ...fixture.inputs, settingsSources: sources };
    const confirm = vi.fn(async () => true);

    for (const id of ['settings.user.in-memory-settings', 'settings.user.browser-storage']) {
      expect(planDoctorRepair(id, inputs, fixture.deps)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('not a repairable check'),
      });
      const outcome = await applyDoctorRepair(id, inputs, fixture.deps, confirm);
      expect(outcome).toMatchObject({ applied: false });
    }

    expect(confirm).not.toHaveBeenCalled();
  });
});
