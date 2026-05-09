import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findAgentServerBoundaryFindings } from '../check-agent-server-boundary.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-agent-server-boundary-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function packageJson(name, dependencies = {}) {
  return JSON.stringify({
    name,
    version: '0.0.0',
    type: 'module',
    dependencies,
  });
}

const requiredDocs = {
  'apps/agent-server/docs/SPEC.md': [
    '# Agent Server Specification',
    'Provider secrets and direct vendor API calls stay server-side in this app.',
    'The server does not own provider semantics, session policy, or Playground UI state.',
  ].join('\n'),
  'apps/agent-web/docs/SPEC.md': [
    '# Web App Specification',
    'The browser host must not import provider packages, `apps/agent-server`, or the root `@robota-sdk/agent-playground` entry.',
  ].join('\n'),
  '.agents/specs/architecture-map/apps-and-deployment.md': [
    '# Apps and Deployment Architecture',
    'Remote execution contract ownership stays in `agent-remote-client` and reusable Playground execution behavior stays in `agent-playground`.',
  ].join('\n'),
};

const requiredManifests = {
  'apps/agent-web/package.json': packageJson('@robota-sdk/agent-web', {
    '@robota-sdk/agent-core': 'workspace:*',
    '@robota-sdk/agent-playground': 'workspace:*',
  }),
  'apps/agent-server/package.json': packageJson('@robota-sdk/agent-server', {
    '@robota-sdk/agent-core': 'workspace:*',
    '@robota-sdk/agent-playground': 'workspace:*',
    '@robota-sdk/agent-provider-openai': 'workspace:*',
  }),
  'packages/agent-playground/package.json': packageJson('@robota-sdk/agent-playground', {
    '@robota-sdk/agent-core': 'workspace:*',
    '@robota-sdk/agent-remote-client': 'workspace:*',
  }),
  'packages/agent-remote-client/package.json': packageJson('@robota-sdk/agent-remote-client', {
    '@robota-sdk/agent-core': 'workspace:*',
  }),
};

const requiredSources = {
  'apps/agent-web/src/app/playground/page.tsx':
    'void import("@robota-sdk/agent-playground/client");\n',
  'apps/agent-server/src/app.ts':
    'import { OpenAIProvider } from "@robota-sdk/agent-provider-openai";\n',
  'packages/agent-playground/src/remote-providers.ts':
    'import { RemoteExecutor } from "@robota-sdk/agent-remote-client";\n',
  'packages/agent-remote-client/src/index.ts':
    'import type { IExecutor } from "@robota-sdk/agent-core";\n',
};

function validFixture(overrides = {}) {
  return {
    ...requiredDocs,
    ...requiredManifests,
    ...requiredSources,
    ...overrides,
  };
}

describe('findAgentServerBoundaryFindings', () => {
  it('accepts the documented browser/server/playground/remote-client boundary', async () => {
    const root = await createFixture(validFixture());

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([]);
  });

  it('flags browser host imports and dependencies that cross into server/provider behavior', async () => {
    const root = await createFixture(
      validFixture({
        'apps/agent-web/package.json': packageJson('@robota-sdk/agent-web', {
          '@robota-sdk/agent-provider-openai': 'workspace:*',
        }),
        'apps/agent-web/src/app/playground/page.tsx': [
          'import { PlaygroundApp } from "@robota-sdk/agent-playground";',
          'import { OpenAIProvider } from "@robota-sdk/agent-provider-openai";',
          'void import("@robota-sdk/agent-playground/client");',
        ].join('\n'),
      }),
    );

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([
      {
        file: 'apps/agent-web/package.json',
        type: 'agent-web-forbidden-dependency',
        detail:
          'agent-web must stay a browser host; provider, server, and remote protocol behavior belongs below the app shell. Found @robota-sdk/agent-provider-openai.',
      },
      {
        file: 'apps/agent-web/src/app/playground/page.tsx',
        type: 'agent-web-forbidden-import',
        detail:
          'agent-web must import only browser-safe Playground entries and must not call providers/server/remote protocol packages directly. Found import @robota-sdk/agent-playground.',
      },
      {
        file: 'apps/agent-web/src/app/playground/page.tsx',
        type: 'agent-web-forbidden-import',
        detail:
          'agent-web must import only browser-safe Playground entries and must not call providers/server/remote protocol packages directly. Found import @robota-sdk/agent-provider-openai.',
      },
    ]);
  });

  it('flags server and remote-client crossings into UI/client concerns', async () => {
    const root = await createFixture(
      validFixture({
        'apps/agent-server/src/app.ts':
          'import { PlaygroundApp } from "@robota-sdk/agent-playground/client";\nexport class SessionPolicy {}\n',
        'packages/agent-remote-client/package.json': packageJson(
          '@robota-sdk/agent-remote-client',
          {
            '@robota-sdk/agent-playground': 'workspace:*',
          },
        ),
        'packages/agent-remote-client/src/index.ts':
          'import { PlaygroundApp } from "@robota-sdk/agent-playground";\n',
      }),
    );

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([
      {
        file: 'packages/agent-remote-client/package.json',
        type: 'remote-client-forbidden-dependency',
        detail:
          'agent-remote-client owns transport client behavior and must not depend on providers, hosts, or Playground UI. Found @robota-sdk/agent-playground.',
      },
      {
        file: 'apps/agent-server/src/app.ts',
        type: 'agent-server-forbidden-import',
        detail:
          'agent-server may compose provider proxying and WebSocket hosting, but must not import browser hosts or remote clients. Found import @robota-sdk/agent-playground/client.',
      },
      {
        file: 'packages/agent-remote-client/src/index.ts',
        type: 'remote-client-forbidden-import',
        detail:
          'agent-remote-client must remain a UI-agnostic transport client over core contracts. Found import @robota-sdk/agent-playground.',
      },
      {
        file: 'apps/agent-server/src/app.ts',
        type: 'agent-server-forbidden-ownership',
        detail:
          'agent-server routing must not become the owner of provider semantics, session policy, or Playground UI state.',
      },
    ]);
  });

  it('flags missing owner documentation', async () => {
    const root = await createFixture(
      validFixture({
        'apps/agent-server/docs/SPEC.md': '# Agent Server Specification\n',
      }),
    );

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([
      {
        file: 'apps/agent-server/docs/SPEC.md',
        type: 'missing-agent-server-secret-boundary',
        detail: 'agent-server SPEC must state provider secret and direct vendor-call ownership.',
      },
      {
        file: 'apps/agent-server/docs/SPEC.md',
        type: 'missing-agent-server-non-ownership-boundary',
        detail:
          'agent-server SPEC must state that provider semantics, session policy, and Playground UI state are not server-owned.',
      },
    ]);
  });
});
