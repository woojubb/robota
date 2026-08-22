import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  classifySpecifierUsage,
  collectReachableModules,
  findAgentServerBoundaryFindings,
} from '../check-agent-server-boundary.mjs';

async function createFixture(files) {
  const root = makeTemp('robota-agent-server-boundary-');
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
  'packages/agent-playground/src/index.ts':
    'export { PlaygroundExecutor } from "./lib/playground-executor";\n',
  'packages/agent-playground/src/lib/playground-executor.ts':
    'export class PlaygroundExecutor {}\n',
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

// HARNESS-051: the required-import rule used to pass on any file containing the token, so a
// never-called module satisfied a boundary the code did not implement. These cases pin the
// difference between an import statement and a wired seam.
describe('required imports must be wired, not merely present', () => {
  it('flags a required import held only by a module no entry point reaches', async () => {
    const root = await createFixture(
      validFixture({
        'apps/agent-web/src/app/playground/page.tsx':
          'export default function Page() {\n  return null;\n}\n',
        'apps/agent-web/src/lib/legacy-remote.ts': [
          'import { PlaygroundApp } from "@robota-sdk/agent-playground/client";',
          'export function renderLegacy() {',
          '  return PlaygroundApp;',
          '}',
        ].join('\n'),
      }),
    );

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([
      {
        file: 'apps/agent-web/src/lib/legacy-remote.ts',
        type: 'agent-web-unwired-browser-safe-playground-import',
        detail: expect.stringContaining(
          'apps/agent-web/src/lib/legacy-remote.ts is not reachable from an entry point',
        ),
      },
    ]);
  });

  it('flags a required import whose binding the importing module never references', async () => {
    const root = await createFixture(
      validFixture({
        'apps/agent-web/src/app/playground/page.tsx':
          'import { PlaygroundApp } from "@robota-sdk/agent-playground/client";\n',
      }),
    );

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([
      {
        file: 'apps/agent-web/src/app/playground/page.tsx',
        type: 'agent-web-unwired-browser-safe-playground-import',
        detail: expect.stringContaining(
          'apps/agent-web/src/app/playground/page.tsx imports it without referencing the binding',
        ),
      },
    ]);
  });

  it('follows a tsconfig path alias when computing reachability', async () => {
    const root = await createFixture(
      validFixture({
        'apps/agent-web/src/app/playground/page.tsx': [
          'import { PlaygroundHost } from "@/components/playground-host";',
          'export default function Page() {',
          '  return PlaygroundHost();',
          '}',
        ].join('\n'),
        'apps/agent-web/src/components/playground-host.tsx': [
          'import { PlaygroundApp } from "@robota-sdk/agent-playground/client";',
          'export function PlaygroundHost() {',
          '  return PlaygroundApp;',
          '}',
        ].join('\n'),
      }),
    );

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([]);
  });

  it('accepts a required import reached transitively from an entry point', async () => {
    const root = await createFixture(
      validFixture({
        'apps/agent-web/src/app/playground/page.tsx': [
          'import { PlaygroundHost } from "../../components/playground-host";',
          'export default function Page() {',
          '  return PlaygroundHost();',
          '}',
        ].join('\n'),
        'apps/agent-web/src/components/playground-host.tsx': [
          'import { PlaygroundApp } from "@robota-sdk/agent-playground/client";',
          'export function PlaygroundHost() {',
          '  return PlaygroundApp;',
          '}',
        ].join('\n'),
      }),
    );

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([]);
  });

  // The withdrawn requirement (HARNESS-051): agent-playground is no longer required to compose
  // agent-remote-client, because nothing in the repo does. The forbidden directions still hold.
  it('does not require agent-playground to import agent-remote-client', async () => {
    const root = await createFixture(
      validFixture({
        'packages/agent-playground/package.json': packageJson('@robota-sdk/agent-playground', {
          '@robota-sdk/agent-core': 'workspace:*',
        }),
      }),
    );

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([]);
  });

  it('still reports a required import that is absent everywhere', async () => {
    const root = await createFixture(
      validFixture({
        'apps/agent-web/src/app/playground/page.tsx':
          'export default function Page() {\n  return null;\n}\n',
      }),
    );

    const findings = await findAgentServerBoundaryFindings(root);

    expect(findings).toEqual([
      {
        file: 'apps/agent-web/src',
        type: 'agent-web-missing-browser-safe-playground-import',
        detail:
          'agent-web should render Playground through the browser-safe @robota-sdk/agent-playground/client entry.',
      },
    ]);
  });
});

describe('classifySpecifierUsage', () => {
  it('reads the bound names of the matching import only', () => {
    const content = [
      "import type { IAIProvider } from '@robota-sdk/agent-core';",
      "import { RemoteExecutor } from '@robota-sdk/agent-remote-client';",
      'export function make() {',
      '  return new RemoteExecutor();',
      '}',
    ].join('\n');

    expect(classifySpecifierUsage(content, '@robota-sdk/agent-remote-client')).toBe('used');
    expect(classifySpecifierUsage(content, '@robota-sdk/agent-core')).toBe('imported-unused');
  });

  it('treats evaluated and forwarding forms as used', () => {
    expect(classifySpecifierUsage("void import('pkg');", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("export { A } from 'pkg';", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("import 'pkg';", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("const a = require('pkg');", 'pkg')).toBe('used');
  });

  it('does not count a mention in a comment or a string literal as a use', () => {
    expect(classifySpecifierUsage("import { A } from 'pkg';\n// A() is coming soon\n", 'pkg')).toBe(
      'imported-unused',
    );
    expect(classifySpecifierUsage("import { A } from 'pkg';\n/* renders A */\n", 'pkg')).toBe(
      'imported-unused',
    );
    expect(classifySpecifierUsage('import { A } from \'pkg\';\nconst label = "A";\n', 'pkg')).toBe(
      'imported-unused',
    );
  });

  it('counts a template-literal reference and survives a URL in a string', () => {
    expect(classifySpecifierUsage("import { A } from 'pkg';\nconst x = `${A}`;\n", 'pkg')).toBe(
      'used',
    );
    expect(
      classifySpecifierUsage('import { A } from \'pkg\';\nconst u = "https://x";\nA();\n', 'pkg'),
    ).toBe('used');
  });

  it('reports an absent specifier and an aliased binding', () => {
    expect(classifySpecifierUsage("import { A } from 'other';", 'pkg')).toBe('absent');
    expect(classifySpecifierUsage("import { A as B } from 'pkg';\nB();", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("import { A as B } from 'pkg';\nA();", 'pkg')).toBe(
      'imported-unused',
    );
  });

  // A type-only import is erased by the compiler, so the emitted module never touches the seam.
  // Counting it as wiring would let a purely type-level reference satisfy a gate that exists to
  // prove runtime reachability — the same defect class this item is closing. Found in review.
  it('does not treat a type-only import as wiring', () => {
    expect(classifySpecifierUsage("import type { A } from 'pkg';\nconst x: A = 1;", 'pkg')).toBe(
      'imported-unused',
    );
    expect(classifySpecifierUsage("import { type A } from 'pkg';\nconst x: A = 1;", 'pkg')).toBe(
      'imported-unused',
    );
    expect(classifySpecifierUsage("import type * as ns from 'pkg';\nlet x: ns.A;", 'pkg')).toBe(
      'imported-unused',
    );
  });

  // A mixed clause binds only its value specifiers.
  it('counts the value half of a mixed type/value import', () => {
    expect(classifySpecifierUsage("import { type A, B } from 'pkg';\nB();", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("import { type A, B } from 'pkg';\nconst x: A = 1;", 'pkg')).toBe(
      'imported-unused',
    );
  });

  // The `used` branch returned before looking at anything else, and it tested RAW content — so a
  // commented-out `import('pkg')` classified as a wired seam. Found in review; same mention-instead-
  // of-wiring shape this item exists to close. Comments are stripped before any import is matched,
  // but string literals are NOT: every pattern matches the quoted specifier, so blanking strings
  // would delete what is being searched for and every import would read as absent.
  it('does not treat a commented-out evaluated import as wiring', () => {
    expect(classifySpecifierUsage("// await import('pkg');\nconst x = 1;", 'pkg')).toBe('absent');
    expect(classifySpecifierUsage("/* await import('pkg'); */\nconst x = 1;", 'pkg')).toBe(
      'absent',
    );
    expect(classifySpecifierUsage("// require('pkg');", 'pkg')).toBe('absent');
    expect(classifySpecifierUsage("// import 'pkg';", 'pkg')).toBe('absent');
    expect(classifySpecifierUsage("// import { A } from 'pkg';\nA();", 'pkg')).toBe('absent');
  });

  it('still classifies real evaluated imports as wiring', () => {
    expect(classifySpecifierUsage("await import('pkg');", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("require('pkg');", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("import 'pkg';", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("export { a } from 'pkg';", 'pkg')).toBe('used');
  });

  // Two sequential strip passes cannot be ordered correctly — each order corrupts real code in the
  // other's case. Block-first (the version this replaced) let a `/*` inside a LINE comment open a
  // block scan and delete everything to the next terminator: measured, the `require` line vanished
  // and a genuinely wired seam read as absent. Line-first instead breaks a block's terminator.
  it('does not let a comment marker inside another comment swallow real code', () => {
    const lineCommentContainingBlockOpen = "// see /* note\nconst w = require('pkg');\n/* real */";
    expect(classifySpecifierUsage(lineCommentContainingBlockOpen, 'pkg')).toBe('used');

    const blockCommentContainingLineMarker = "/* a // b */\nconst w = require('pkg');";
    expect(classifySpecifierUsage(blockCommentContainingLineMarker, 'pkg')).toBe('used');
  });

  // The `[^:]` guard: without it every `https://…` reads as a comment and deletes the rest of its line.
  it('does not mistake a URL for a line comment', () => {
    expect(classifySpecifierUsage("const u = 'https://x'; require('pkg');", 'pkg')).toBe('used');
  });

  // A file containing `const example = "await import('pkg')"` classified as a wired seam — a token
  // appearing somewhere in the file, which is the class this gate exists to reject. Blanking every
  // string literal is not the fix either: each pattern matches the QUOTED specifier, so the search
  // target would vanish and every import would read absent. Only literals whose content IS the
  // specifier survive.
  it('does not treat an import written inside a string literal as wiring', () => {
    expect(classifySpecifierUsage(`const ex = "await import('pkg')";`, 'pkg')).toBe('absent');
    expect(classifySpecifierUsage(`const ex = "require('pkg')";`, 'pkg')).toBe('absent');
    expect(classifySpecifierUsage(`const doc = "import { A } from 'pkg'";`, 'pkg')).toBe('absent');
  });

  it('leaves a bare specifier-valued constant unwired', () => {
    expect(classifySpecifierUsage("const name = 'pkg';", 'pkg')).toBe('absent');
  });

  it('still classifies every real wiring form as used', () => {
    expect(classifySpecifierUsage("await import('pkg');", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("require('pkg');", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("import 'pkg';", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("export { a } from 'pkg';", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("import { A } from 'pkg';\nA();", 'pkg')).toBe('used');
  });

  // Same rule as the import side, one review round later on the branch that had not been given it:
  // `export type { X } from 'pkg'` is erased by the compiler and forwards nothing at runtime.
  it('does not treat a type-only re-export as wiring', () => {
    expect(classifySpecifierUsage("export type { X } from 'pkg';", 'pkg')).toBe('absent');
    expect(classifySpecifierUsage("export { type X } from 'pkg';", 'pkg')).toBe('absent');
  });

  it('treats every runtime re-export form as wiring', () => {
    expect(classifySpecifierUsage("export { A } from 'pkg';", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("export { A as B } from 'pkg';", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("export { type A, B } from 'pkg';", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("export * from 'pkg';", 'pkg')).toBe('used');
    expect(classifySpecifierUsage("export * as ns from 'pkg';", 'pkg')).toBe('used');
  });

  // A check added later without an entryPattern would have crashed on `undefined.test` and taken
  // the whole scan down. A guard that dies is a guard that gets skipped, so it fails closed with
  // the reason instead. There is no safe default: entry points are declared per check, never inferred.
  it('fails closed when a check declares no entry pattern', () => {
    const contents = new Map([['a.ts', '']]);
    expect(() => collectReachableModules(contents, undefined)).toThrow(/requires an entryPattern/);
    expect(() => collectReachableModules(contents, 'src/')).toThrow(/requires an entryPattern/);
    expect(collectReachableModules(contents, /a\.ts/).size).toBe(1);
  });
});
