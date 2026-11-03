/**
 * #3679 (secure conversation): every conversation store a product package builds — session records,
 * session logs, the prompt history, the tool-result spill, edit checkpoints — comes from
 * `packages/agent-cli/src/product/session-stores.ts`, which states how it seals. The SDK's store
 * constructors default to plain for embedders, so a product store built anywhere else would write
 * plaintext beside sealed files once secure mode is on.
 * The repository's ESLint config refuses a value import of any of them in the product packages
 * outside that file; this pins what the rule catches — aliased or not, re-exported or reached through
 * a namespace — and what it leaves alone.
 */
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RULE = '@typescript-eslint/no-restricted-imports';

// Typed linting needs each file in a tsconfig; these snippets are linted at paths that exist in none,
// and the rule under test needs no types.
const eslint = new ESLint({
  cwd: REPO_ROOT,
  overrideConfig: {
    parserOptions: { project: null },
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
});

async function restrictedImports(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath: `${REPO_ROOT}${filePath}` });
  return result.messages.filter((message) => message.ruleId === RULE).length;
}

const PRODUCT_FILES = [
  'packages/agent-cli/src/startup/new-command.ts',
  'packages/agent-cli/src/testing/new-driver.ts',
  'packages/agent-ui-terminal/src/new-hook.ts',
  'packages/agent-product/src/new-module.ts',
  'apps/agent-app/src/new-module.ts',
];

const BUILDS_A_STORE = [
  "import { createUserSessionStore } from '@robota-sdk/agent-framework';",
  "import { createProjectSessionStore as projectStore } from '@robota-sdk/agent-framework';",
  "import { createNodeHostSessionStore, readSettings } from '@robota-sdk/agent-framework';",
  "import { WorkspaceProjectSessionStore as Store } from '@robota-sdk/agent-framework';",
  "import { NodeSessionStore as Store } from '@robota-sdk/agent-session';",
  "import { createUserPromptHistoryFile } from '@robota-sdk/agent-framework';",
  "import { WorkspaceSessionLogSink as Sink } from '@robota-sdk/agent-framework';",
  "import { WorkspaceSessionLogSource } from '@robota-sdk/agent-framework';",
  "import { createSubagentLogger } from '@robota-sdk/agent-framework';",
  "import { NodePromptHistoryFile } from '@robota-sdk/agent-session';",
  "import { NodeSessionLogSink, loadSessionLogEntries } from '@robota-sdk/agent-session';",
  "import { NodeSessionLogSource as Source } from '@robota-sdk/agent-session';",
  "import { createNodeToolResultSpillStore } from '@robota-sdk/agent-framework';",
  "import { NodeToolResultSpillStore as Spill } from '@robota-sdk/agent-session';",
  "import { EditCheckpointStore } from '@robota-sdk/agent-framework';",
  "import { createDirectoryEditCheckpointState as ephemeral } from '@robota-sdk/agent-framework';",
  "import * as framework from '@robota-sdk/agent-framework';",
  "import * as session from '@robota-sdk/agent-session';",
  "export { createUserSessionStore } from '@robota-sdk/agent-framework';",
  "export { NodeSessionStore as Store } from '@robota-sdk/agent-session';",
  "export { createUserPromptHistoryFile } from '@robota-sdk/agent-framework';",
  "export { NodeSessionLogSink } from '@robota-sdk/agent-session';",
  "export { createNodeToolResultSpillStore } from '@robota-sdk/agent-framework';",
  "export { EditCheckpointStore as Store } from '@robota-sdk/agent-framework';",
];

describe('session stores are built only by the product factory', () => {
  it.each(PRODUCT_FILES)(
    'refuses every value import of a store constructor in %s',
    async (file) => {
      for (const code of BUILDS_A_STORE) {
        expect(await restrictedImports(code, file), code).toBe(1);
      }
    },
  );

  it('allows the factory itself, type-only imports, other names, and tests', async () => {
    const factory = 'packages/agent-cli/src/product/session-stores.ts';
    expect(
      await restrictedImports(
        "import { createUserSessionStore, createProjectSessionStore } from '@robota-sdk/agent-framework';",
        factory,
      ),
    ).toBe(0);
    expect(
      await restrictedImports(
        "import { createUserPromptHistoryFile, WorkspaceSessionLogSink } from '@robota-sdk/agent-framework';",
        factory,
      ),
    ).toBe(0);
    expect(
      await restrictedImports(
        "import { createNodeToolResultSpillStore } from '@robota-sdk/agent-framework';",
        factory,
      ),
    ).toBe(0);
    expect(
      await restrictedImports(
        "import { EditCheckpointStore, createDirectoryEditCheckpointState } from '@robota-sdk/agent-framework';",
        factory,
      ),
    ).toBe(0);
    for (const code of [
      "import type { IHostToolResultSpillStore } from '@robota-sdk/agent-framework';",
      "import { sweepStaleToolResultSpillDirectories } from '@robota-sdk/agent-framework';",
      "import type { WorkspaceProjectSessionStore } from '@robota-sdk/agent-framework';",
      "import type { NodeSessionStore } from '@robota-sdk/agent-session';",
      "import type { NodePromptHistoryFile, NodeSessionLogSource } from '@robota-sdk/agent-session';",
      "import type { WorkspaceSessionLogSink } from '@robota-sdk/agent-framework';",
      "import type { EditCheckpointStore, IEditCheckpointStateStorage } from '@robota-sdk/agent-framework';",
      "import { createSealedEditCheckpointState, EditCheckpointsLockedError } from '@robota-sdk/agent-framework';",
      "import { readSettings, scanSessionStore } from '@robota-sdk/agent-framework';",
      "import { loadSessionForUpdate, NodeExternalPayloadSource } from '@robota-sdk/agent-session';",
    ]) {
      expect(await restrictedImports(code, PRODUCT_FILES[0]), code).toBe(0);
    }
    expect(
      await restrictedImports(
        "import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';",
        'packages/agent-cli/src/__tests__/a-fixture.test.ts',
      ),
    ).toBe(0);
  });

  it('leaves packages that are not the product alone', async () => {
    expect(
      await restrictedImports(
        "import { NodeSessionStore } from '@robota-sdk/agent-session';",
        'packages/agent-framework/src/interactive/new-store.ts',
      ),
    ).toBe(0);
  });
});
