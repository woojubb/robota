/**
 * NEUT-002 — builtin tool descriptions are a model-facing contract:
 * - mechanism-only text (no foreign product/workflow policy),
 * - cross-tool references derived from names that actually exist here,
 * - a description-override seam on every builtin factory.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { createEditTool } from '../builtins/edit-tool.js';
import { createGlobTool } from '../builtins/glob-tool.js';
import { createGrepTool } from '../builtins/grep-tool.js';
import { createShellTool } from '../builtins/shell-tool.js';
import { createWriteTool } from '../builtins/write-tool.js';

/**
 * ARCH-010 made the containment root a required constructor argument and deleted the module-level
 * singletons this file used to read descriptions from. Every case here asks a tool for its DESCRIPTION
 * and never touches the filesystem, so the root is inert — it is named once, here, so that inertness is
 * visible rather than implied, and it is the OS temp directory rather than the repo so a case that ever
 * did reach the disk could not read the source tree.
 */
const DESCRIPTION_ROOT = tmpdir();
/** A second inert root, used only to show the default description does not vary with it. */
const OTHER_DESCRIPTION_ROOT = join(tmpdir(), 'neut002-other-root');

describe('builtin descriptions carry no foreign product policy (NEUT-002)', () => {
  it('Write does not forbid documentation/README files (workflow policy, not mechanism)', () => {
    expect(createWriteTool({ cwd: DESCRIPTION_ROOT }).getDescription()).not.toMatch(
      /NEVER create documentation|README files/i,
    );
  });

  it('Glob does not reference a nonexistent "Agent tool"', () => {
    expect(createGlobTool({ cwd: DESCRIPTION_ROOT }).getDescription()).not.toMatch(/Agent tool/);
  });

  it('Grep references the default shell tool name `Shell`, not `Bash`', () => {
    const description = createGrepTool({ cwd: DESCRIPTION_ROOT }).getDescription();
    expect(description).not.toMatch(/Bash command/);
    expect(description).toContain('Shell');
  });

  it('Edit does not claim an unenforced read-first contract', () => {
    expect(createEditTool({ cwd: DESCRIPTION_ROOT }).getDescription()).not.toMatch(
      /must use the Read tool at least once/i,
    );
  });
});

describe('description override seam on every builtin factory (NEUT-002)', () => {
  const OVERRIDE = 'custom description for this deployment';

  it('createShellTool / createBashTool accept a description override', async () => {
    const mod = await import('../builtins/shell-tool.js');
    expect(
      mod.createShellTool({ cwd: DESCRIPTION_ROOT, description: OVERRIDE }).getDescription(),
    ).toBe(OVERRIDE);
    expect(
      mod.createBashTool({ cwd: DESCRIPTION_ROOT, description: OVERRIDE }).getDescription(),
    ).toBe(OVERRIDE);
  });

  it('createReadTool accepts a description override', async () => {
    const mod = await import('../builtins/read-tool.js');
    expect(
      mod.createReadTool({ cwd: DESCRIPTION_ROOT, description: OVERRIDE }).getDescription(),
    ).toBe(OVERRIDE);
  });

  it('createWriteTool accepts a description override', async () => {
    const mod = await import('../builtins/write-tool.js');
    expect(
      mod.createWriteTool({ cwd: DESCRIPTION_ROOT, description: OVERRIDE }).getDescription(),
    ).toBe(OVERRIDE);
  });

  it('createEditTool accepts a description override', async () => {
    const mod = await import('../builtins/edit-tool.js');
    expect(
      mod.createEditTool({ cwd: DESCRIPTION_ROOT, description: OVERRIDE }).getDescription(),
    ).toBe(OVERRIDE);
  });

  it('createGlobTool exists and accepts a description override (default text is root-independent)', async () => {
    const mod = await import('../builtins/glob-tool.js');
    expect(typeof mod.createGlobTool).toBe('function');
    expect(
      mod.createGlobTool({ cwd: DESCRIPTION_ROOT, description: OVERRIDE }).getDescription(),
    ).toBe(OVERRIDE);
    // ARCH-010 deleted the singleton this used to compare against. The claim it stood for survives:
    // omitting `description` yields the built-in default, and the containment root does not alter it.
    const defaultDescription = mod.createGlobTool({ cwd: DESCRIPTION_ROOT }).getDescription();
    expect(defaultDescription).not.toBe(OVERRIDE);
    expect(defaultDescription).toBe(
      mod.createGlobTool({ cwd: OTHER_DESCRIPTION_ROOT }).getDescription(),
    );
  });

  it('createGrepTool exists and accepts a description override (default text is root-independent)', async () => {
    const mod = await import('../builtins/grep-tool.js');
    expect(typeof mod.createGrepTool).toBe('function');
    expect(
      mod.createGrepTool({ cwd: DESCRIPTION_ROOT, description: OVERRIDE }).getDescription(),
    ).toBe(OVERRIDE);
    // Same inversion of subject as Glob above: the deleted singleton's role was to pin the default.
    const defaultDescription = mod.createGrepTool({ cwd: DESCRIPTION_ROOT }).getDescription();
    expect(defaultDescription).not.toBe(OVERRIDE);
    expect(defaultDescription).toBe(
      mod.createGrepTool({ cwd: OTHER_DESCRIPTION_ROOT }).getDescription(),
    );
  });

  it('createWebFetchTool exists and accepts a description override', async () => {
    const mod = await import('../builtins/web-fetch-tool.js');
    expect(typeof mod.createWebFetchTool).toBe('function');
    expect(mod.createWebFetchTool({ description: OVERRIDE }).getDescription()).toBe(OVERRIDE);
  });

  it('createWebSearchTool exists and accepts a description override', async () => {
    const mod = await import('../builtins/web-search-tool.js');
    expect(typeof mod.createWebSearchTool).toBe('function');
    expect(mod.createWebSearchTool({ description: OVERRIDE }).getDescription()).toBe(OVERRIDE);
  });

  it('createAskUserQuestionTool accepts a description override', async () => {
    const mod = await import('../builtins/ask-user-question-tool.js');
    expect(mod.createAskUserQuestionTool({ description: OVERRIDE }).getDescription()).toBe(
      OVERRIDE,
    );
  });
});

describe('shell routing hints derive from the registered tool set (NEUT-002)', () => {
  it('default description keeps all dedicated-tool routing hints (default assembly unchanged)', () => {
    const description = createShellTool({ cwd: DESCRIPTION_ROOT }).getDescription();
    expect(description).toContain('Use Glob');
    expect(description).toContain('Use Grep');
    expect(description).toContain('Use Read');
    expect(description).toContain('Use Edit');
  });

  it('with only Shell registered, routing hints to unregistered siblings are omitted', () => {
    const description = createShellTool({
      cwd: DESCRIPTION_ROOT,
      availableTools: ['Shell'],
    }).getDescription();
    expect(description).not.toContain('Use Glob');
    expect(description).not.toContain('Use Grep');
    expect(description).not.toContain('Use Read');
    expect(description).not.toContain('Use Edit');
  });

  it('routing hints mention exactly the registered subset', () => {
    const description = createShellTool({
      cwd: DESCRIPTION_ROOT,
      availableTools: ['Shell', 'Glob'],
    }).getDescription();
    expect(description).toContain('Use Glob');
    expect(description).not.toContain('Use Grep');
    expect(description).not.toContain('Use Edit');
  });
});

describe('grep description derives the shell tool name (NEUT-002)', () => {
  it('createGrepTool({ shellToolName }) names that tool in the default text', async () => {
    const mod = await import('../builtins/grep-tool.js');
    const description = mod
      .createGrepTool({ cwd: DESCRIPTION_ROOT, shellToolName: 'Terminal' })
      .getDescription();
    expect(description).toContain('Terminal');
    expect(description).not.toContain('Shell');
  });
});
