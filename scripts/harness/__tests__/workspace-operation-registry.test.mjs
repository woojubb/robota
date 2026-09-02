import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readWorkspaceGraph } from '../workspace-affected.mjs';
import {
  classifyRootScript,
  resolveWorkspaceCapability,
  rootScriptForOperation,
  ROOT_SCRIPT_CLASSES,
  ROOT_SCRIPT_DESCRIPTORS,
  WORKSPACE_OPERATION_ROOT_SCRIPTS,
  WORKSPACE_OPERATION_SCRIPTS,
} from '../workspace-operation-registry.mjs';

describe('workspace operation registry', () => {
  it('classifies every root script exactly once and rejects unreviewed additions', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    );
    const rootScripts = Object.keys(manifest.scripts).sort();
    expect(rootScripts.length).toBeGreaterThanOrEqual(119);
    const registered = Object.values(ROOT_SCRIPT_CLASSES).flat().sort();
    expect(registered).toEqual(rootScripts);
    expect(Object.keys(ROOT_SCRIPT_DESCRIPTORS).sort()).toEqual(rootScripts);
    for (const script of rootScripts) {
      expect(classifyRootScript(script)).toEqual({
        scriptName: script,
        matches: [expect.any(String)],
        classification: expect.any(String),
      });
    }
  });

  it('maps affected-capable full and selective scripts to executable operation descriptors', () => {
    for (const [operation, scripts] of Object.entries(WORKSPACE_OPERATION_ROOT_SCRIPTS)) {
      expect(rootScriptForOperation(operation, 'full')).toBe(scripts.full);
      if (scripts.affected)
        expect(rootScriptForOperation(operation, 'affected')).toBe(scripts.affected);
      for (const execution of ['full', 'affected']) {
        const script = scripts[execution];
        if (!script) continue;
        expect(ROOT_SCRIPT_DESCRIPTORS[script]).toMatchObject({
          operation: operation === 'consumer-build' ? 'build' : operation,
          execution,
        });
      }
    }
  });

  it('classifies unsupported generic commands honestly without affected execution descriptors', () => {
    expect(ROOT_SCRIPT_DESCRIPTORS.dev).toEqual({ classification: 'aggregate' });
    expect(ROOT_SCRIPT_DESCRIPTORS.clean).toEqual({ classification: 'aggregate' });
    expect(ROOT_SCRIPT_DESCRIPTORS['docs:dev']).toEqual({ classification: 'targeted' });
    expect(ROOT_SCRIPT_DESCRIPTORS['web:build']).toEqual({ classification: 'targeted' });
  });

  it('classifies every workspace operation as a real script, root lint, or explicit N/A', () => {
    const graph = readWorkspaceGraph(process.cwd());
    for (const workspacePackage of graph.packages) {
      for (const operation of Object.keys(WORKSPACE_OPERATION_SCRIPTS)) {
        const capability = resolveWorkspaceCapability(workspacePackage, operation);
        expect(capability.kind, `${workspacePackage.directory}#${operation}`).not.toBe(
          'unclassified',
        );
        if (capability.kind === 'not-applicable') expect(capability.reason.trim()).not.toBe('');
      }
    }
  });

  it('does not convert an unknown missing script into a passing capability', () => {
    expect(
      resolveWorkspaceCapability(
        { name: '@fixture/new', directory: 'tools/new', scripts: {} },
        'test',
      ),
    ).toMatchObject({ kind: 'unclassified', reason: expect.stringContaining('no test script') });
  });
});
