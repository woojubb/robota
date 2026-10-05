import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkExecutionContainment,
  createProductSandbox,
  createSandboxCommandAdapter,
  sandboxStartupProblem,
} from '../execution-containment.js';

import type { IOsSandboxAvailability } from '@robota-sdk/agent-tools';

/** Issues #3081, #3082 — the product composes its sandbox from settings, and the doctor reports it. */
const linux: IOsSandboxAvailability = { backend: 'bubblewrap', executable: 'bwrap', missing: [] };
const missing: IOsSandboxAvailability = {
  backend: 'bubblewrap',
  missing: ['bubblewrap (install the `bubblewrap` package)'],
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'test-product-containment-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function sandboxWith(settings: object | undefined, availability: IOsSandboxAvailability) {
  const path = join(root, 'settings.json');
  writeFileSync(path, JSON.stringify(settings === undefined ? {} : { sandbox: settings }));
  return createProductSandbox({productRuntime: createTestProductRuntime(),
    cwd: root,
    settingsSources: [createNodeHostSettingsSource('user', path)],
    detect: () => availability,
  });
}

describe('test-product execution containment', () => {
  it('hides the credential-bearing user-state entries from confined commands (issue #3429)', () => {
    const runtime = createTestProductRuntime();
    const sandbox = sandboxWith({ enabled: true }, linux);
    const hidden = sandbox.client?.policy().denyRead.map((entry) => entry.path) ?? [];
    // Paths are made real (macOS `/var` is `/private/var`), so compare the user-root-relative tail.
    const state = basename(runtime.layout.userRoot);
    for (const entry of ['settings.json', 'credentials', 'mcp-credentials', 'remote-host-identity.json']) {
      expect(hidden.some((path) => path.endsWith(join(state, entry)))).toBe(true);
    }
    expect(hidden.some((path) => path.endsWith(state))).toBe(false);
  });

  it('composes an idle client by default, and the doctor says commands run on the host', () => {
    const sandbox = sandboxWith(undefined, linux);
    expect(sandbox.client?.status().active).toBe(false);
    const check = checkExecutionContainment(sandbox);
    expect(check).toMatchObject({ id: 'execution.containment', status: 'ok', cause: 'host' });
    expect(check.detail?.join(' ')).toContain('Sandboxing is off');
  });

  it('reads the settings into a live client', () => {
    const sandbox = sandboxWith(
      {
        enabled: true,
        excludedCommands: ['docker'],
        filesystem: { allowWrite: ['~/.cache'] },
        network: { enabled: true },
      },
      linux,
    );
    expect(sandbox.client?.status()).toMatchObject({
      active: true,
      settings: { excludedCommands: ['docker'], allowWrite: ['~/.cache'], network: true },
    });
    const check = checkExecutionContainment(sandbox);
    expect(check.cause).toBe('sandbox-shared');
    expect(check.detail?.join(' ')).toContain('network allowed');
  });

  it('warns when enabled but unavailable, and refuses when told to', () => {
    expect(sandboxStartupProblem(sandboxWith({ enabled: true }, missing))).toEqual({
      fatal: false,
      message: expect.stringContaining('missing bubblewrap'),
    });
    const strict = sandboxWith({ enabled: true, failIfUnavailable: true }, missing);
    expect(sandboxStartupProblem(strict)?.fatal).toBe(true);
    expect(checkExecutionContainment(strict).status).toBe('fail');
    expect(sandboxStartupProblem(sandboxWith({ enabled: false }, missing))).toBeUndefined();
  });

  it('composes no client where the platform has no backend', () => {
    const sandbox = sandboxWith({ enabled: true }, { missing: [], unsupportedPlatform: 'win32' });
    expect(sandbox.client).toBeUndefined();
    expect(sandboxStartupProblem(sandbox)?.message).toContain(
      'no sandbox backend exists for win32',
    );
  });
});

describe('the /sandbox adapter', () => {
  it('changes the live client for the next command and saves the mode, keeping other settings', () => {
    const sandbox = sandboxWith({ excludedCommands: ['docker'] }, linux);
    let saved: Record<string, unknown> = {
      language: 'ko',
      sandbox: { excludedCommands: ['docker'] },
    };
    const adapter = createSandboxCommandAdapter(sandbox, {
      read: () => saved as never,
      write: (document) => {
        saved = document;
      },
    });
    expect(adapter.status()).toMatchObject({ mode: 'off', backend: 'bubblewrap' });
    adapter.setMode('regular');
    expect(sandbox.client?.confines('npm test')).toBe(true);
    expect(sandbox.client?.autoApproves('npm test')).toBe(false);
    adapter.setMode('auto-allow');
    expect(sandbox.client?.autoApproves('npm test')).toBe(true);
    expect(adapter.status().mode).toBe('auto-allow');
    expect(saved).toEqual({
      language: 'ko',
      sandbox: { excludedCommands: ['docker'], enabled: true, autoAllowBashIfSandboxed: true },
    });
  });

  it('reports what is missing where the backend cannot run', () => {
    const adapter = createSandboxCommandAdapter(sandboxWith({ enabled: true }, missing), {
      read: () => ({}),
      write: () => undefined,
    });
    expect(adapter.status().unavailable).toContain('missing bubblewrap');
  });
});
