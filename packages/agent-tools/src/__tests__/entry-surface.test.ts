import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

/**
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"); what touches a host is on
 * `./node`. The platform gate reads the manifest, which still maps the main entry `"browser": null`,
 * so it does not look at the main entry's source; this pins which side each export is on, so a move
 * is a visible test failure.
 */

/**
 * The only Node exports of the main entry. The published `@robota-sdk/workflows` 0.0.3, which
 * agent-cli bundles, imports exactly these from here. They leave with the next workflows release,
 * and the main entry loses `"browser": null` in the same change.
 */
const BUNDLED_WORKFLOWS_0_0_3_NAMES = [
  'GrepIsolationError',
  'ReadByteLimitError',
  'ReadCancelledError',
  'createBashTool',
  'createEditTool',
  'createGlobTool',
  'createGrepTool',
  'createReadTool',
  'createShellTool',
  'createWriteTool',
  'webFetchTool',
];

const NEUTRAL_MAIN_NAMES = [
  'E2BSandboxClient',
  'InMemorySandboxClient',
  'PageComputerDriver',
  'REPO_MAP_INDEX_VERSION',
  'RepoMapRetrievalAdapter',
  'TOOL_SEARCH_NAME',
  'DEFAULT_TOOL_SEARCH_LIMIT',
  'applyWorkspaceManifest',
  'askUserQuestionTool',
  'buildRepoMapIndex',
  'createAskUserQuestionTool',
  'createComputerActTool',
  'createComputerTool',
  'createComputerViewTool',
  'createFunctionTool',
  'createRetrievalTool',
  'createToolSearchTool',
  'createZodFunctionTool',
  'describeExecutionContainment',
  'deserializeRepoMapIndex',
  'matchDeferredTools',
  'routesFilesThroughSandbox',
  'serializeRepoMapIndex',
  'toolSearchTool',
  'updateRepoMapIndex',
  'validateWorkspaceManifestPath',
];

const NODE_ENTRY_NAMES = [
  ...BUNDLED_WORKFLOWS_0_0_3_NAMES,
  'DEFAULT_OS_SANDBOX_SETTINGS',
  'OsSandboxClient',
  'bubblewrapArguments',
  'createNodeWorkspaceHostFiles',
  'createWebFetchTool',
  'detectOsSandbox',
  'protectedWorkspaceEntries',
  'seatbeltProfile',
];

const sorted = (names: readonly string[]): string[] => [...names].sort();

describe('agent-tools entry surfaces', () => {
  it('the main entry holds the neutral exports and exactly the eleven names workflows 0.0.3 imports', () => {
    expect(sorted(Object.keys(MainEntry))).toEqual(
      sorted([...NEUTRAL_MAIN_NAMES, ...BUNDLED_WORKFLOWS_0_0_3_NAMES]),
    );
  });

  it('the eleven names on the main entry are the ./node exports themselves', () => {
    for (const name of BUNDLED_WORKFLOWS_0_0_3_NAMES) {
      expect((MainEntry as Record<string, unknown>)[name], name).toBe(
        (NodeEntry as Record<string, unknown>)[name],
      );
    }
  });

  it('./node holds every export that needs a host', () => {
    expect(sorted(Object.keys(NodeEntry))).toEqual(sorted(NODE_ENTRY_NAMES));
  });

  it.each(NODE_ENTRY_NAMES.filter((name) => !BUNDLED_WORKFLOWS_0_0_3_NAMES.includes(name)))(
    '%s is on ./node and not on the main entry',
    (name) => {
      expect(Object.keys(NodeEntry)).toContain(name);
      expect(Object.keys(MainEntry)).not.toContain(name);
    },
  );

  it.each(NEUTRAL_MAIN_NAMES)('%s is on the main entry and not on ./node', (name) => {
    expect(Object.keys(MainEntry)).toContain(name);
    expect(Object.keys(NodeEntry)).not.toContain(name);
  });
});

/**
 * CORE-030: each tool module tells the permission system what its tool does as it loads, so a tool
 * has a classification on whichever entry carries it. Each case loads one entry into a fresh module
 * registry and asks the permission system about a tool that entry defines.
 */
describe('permission profiles are registered by each entry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('the main entry classifies its tools', async () => {
    const core = await import('@robota-sdk/agent-core');
    expect(core.evaluatePermission('ToolSearch', {}, 'plan')).not.toBe('auto');

    await import('../index.js');

    expect(core.evaluatePermission('ToolSearch', {}, 'plan')).toBe('auto');
    expect(core.evaluatePermission('CodebaseRetrieval', {}, 'plan')).toBe('auto');
  });

  it('./node classifies its tools', async () => {
    const core = await import('@robota-sdk/agent-core');
    expect(core.evaluatePermission('Read', {}, 'plan')).not.toBe('auto');

    await import('../node.js');

    expect(core.evaluatePermission('Read', {}, 'plan')).toBe('auto');
    expect(core.evaluatePermission('Write', {}, 'acceptEdits')).toBe('auto');
  });
});
