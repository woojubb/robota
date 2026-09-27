import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

/**
 * #3289 §3 — "Project memory is unavailable without a workspace project authority." named an
 * internal concept (a "workspace project authority") a person cannot act on. `getMemoryStore()`
 * throws before touching the filesystem, so this needs no session initialization.
 */

let workspace: string;

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'memory-unavailable-')));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe('a session with no injected memory store', () => {
  it('says plainly that project memory is not available for this folder', () => {
    const scripted = createScriptedProvider([]);
    const session = new InteractiveSession({ cwd: workspace, provider: scripted.provider, bare: true });

    expect(() => session.getMemoryStore()).toThrow("Project memory isn't available for this folder.");
    expect(() => session.getMemoryStore()).not.toThrow(/workspace project authority/);
  });
});
