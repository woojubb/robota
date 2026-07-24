/**
 * NEUT-002 — builtin tool descriptions are a model-facing contract:
 * - mechanism-only text (no foreign product/workflow policy),
 * - cross-tool references derived from names that actually exist here,
 * - a description-override seam on every builtin factory.
 */

import { describe, it, expect } from 'vitest';

import { editTool } from '../builtins/edit-tool.js';
import { globTool } from '../builtins/glob-tool.js';
import { grepTool } from '../builtins/grep-tool.js';
import { createShellTool, shellTool } from '../builtins/shell-tool.js';
import { writeTool } from '../builtins/write-tool.js';

describe('builtin descriptions carry no foreign product policy (NEUT-002)', () => {
  it('Write does not forbid documentation/README files (workflow policy, not mechanism)', () => {
    expect(writeTool.getDescription()).not.toMatch(/NEVER create documentation|README files/i);
  });

  it('Glob does not reference a nonexistent "Agent tool"', () => {
    expect(globTool.getDescription()).not.toMatch(/Agent tool/);
  });

  it('Grep references the default shell tool name `Shell`, not `Bash`', () => {
    const description = grepTool.getDescription();
    expect(description).not.toMatch(/Bash command/);
    expect(description).toContain('Shell');
  });

  it('Edit does not claim an unenforced read-first contract', () => {
    expect(editTool.getDescription()).not.toMatch(/must use the Read tool at least once/i);
  });
});

describe('description override seam on every builtin factory (NEUT-002)', () => {
  const OVERRIDE = 'custom description for this deployment';

  it('createShellTool / createBashTool accept a description override', async () => {
    const mod = await import('../builtins/shell-tool.js');
    expect(mod.createShellTool({ description: OVERRIDE }).getDescription()).toBe(OVERRIDE);
    expect(mod.createBashTool({ description: OVERRIDE }).getDescription()).toBe(OVERRIDE);
  });

  it('createReadTool accepts a description override', async () => {
    const mod = await import('../builtins/read-tool.js');
    expect(mod.createReadTool({ description: OVERRIDE }).getDescription()).toBe(OVERRIDE);
  });

  it('createWriteTool accepts a description override', async () => {
    const mod = await import('../builtins/write-tool.js');
    expect(mod.createWriteTool({ description: OVERRIDE }).getDescription()).toBe(OVERRIDE);
  });

  it('createEditTool accepts a description override', async () => {
    const mod = await import('../builtins/edit-tool.js');
    expect(mod.createEditTool({ description: OVERRIDE }).getDescription()).toBe(OVERRIDE);
  });

  it('createGlobTool exists and accepts a description override (singleton unchanged)', async () => {
    const mod = await import('../builtins/glob-tool.js');
    expect(typeof mod.createGlobTool).toBe('function');
    expect(mod.createGlobTool({ description: OVERRIDE }).getDescription()).toBe(OVERRIDE);
    expect(mod.createGlobTool().getDescription()).toBe(globTool.getDescription());
  });

  it('createGrepTool exists and accepts a description override (singleton unchanged)', async () => {
    const mod = await import('../builtins/grep-tool.js');
    expect(typeof mod.createGrepTool).toBe('function');
    expect(mod.createGrepTool({ description: OVERRIDE }).getDescription()).toBe(OVERRIDE);
    expect(mod.createGrepTool().getDescription()).toBe(grepTool.getDescription());
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
    const description = shellTool.getDescription();
    expect(description).toContain('Use Glob');
    expect(description).toContain('Use Grep');
    expect(description).toContain('Use Read');
    expect(description).toContain('Use Edit');
  });

  it('with only Shell registered, routing hints to unregistered siblings are omitted', () => {
    const description = createShellTool({ availableTools: ['Shell'] }).getDescription();
    expect(description).not.toContain('Use Glob');
    expect(description).not.toContain('Use Grep');
    expect(description).not.toContain('Use Read');
    expect(description).not.toContain('Use Edit');
  });

  it('routing hints mention exactly the registered subset', () => {
    const description = createShellTool({ availableTools: ['Shell', 'Glob'] }).getDescription();
    expect(description).toContain('Use Glob');
    expect(description).not.toContain('Use Grep');
    expect(description).not.toContain('Use Edit');
  });
});

describe('grep description derives the shell tool name (NEUT-002)', () => {
  it('createGrepTool({ shellToolName }) names that tool in the default text', async () => {
    const mod = await import('../builtins/grep-tool.js');
    const description = mod.createGrepTool({ shellToolName: 'Terminal' }).getDescription();
    expect(description).toContain('Terminal');
    expect(description).not.toContain('Shell');
  });
});
