import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  GITHUB_BLOB_BASE,
  GITHUB_RAW_BASE,
  GITHUB_TREE_BASE,
  resolveDocImage,
  resolveDocLink,
} from './remark-fix-links';

let repoRoot: string;

function touch(relPath: string): void {
  const abs = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '# x\n');
}

function resolveFrom(sourceRel: string, href: string, locale = 'en'): string {
  return resolveDocLink(href, { sourcePath: path.join(repoRoot, sourceRel), locale, repoRoot });
}

beforeAll(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-links-'));
  for (const f of [
    'content/README.md',
    'content/guide/README.md',
    'content/guide/cli.md',
    'content/guide/plugins.md',
    'content/ko/getting-started/README.md',
    'content/getting-started/README.md',
    'content/v2.0.0/README.md',
    'packages/agent-core/README.md',
    'packages/agent-core/docs/README.md',
    'packages/agent-core/docs/SPEC.md',
    'packages/agent-core/src/index.ts',
    'packages/dag-nodes/docs/README.md',
    'packages/dag-nodes/llm-text/docs/README.md',
    'examples/express/src/index.ts',
    'packages/agent-cli/docs/demo.gif',
  ]) {
    touch(f);
  }
});

afterAll(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('resolveDocLink', () => {
  it('resolves a sibling link from a leaf page against the source file, not the page URL', () => {
    expect(resolveFrom('content/guide/cli.md', './plugins.md')).toBe('/en/guide/plugins/');
    expect(resolveFrom('content/guide/cli.md', 'plugins.md#hooks')).toBe('/en/guide/plugins/#hooks');
  });

  it('maps README files and directories to their section route', () => {
    expect(resolveFrom('content/README.md', './guide/README.md')).toBe('/en/guide/');
    expect(resolveFrom('content/README.md', './getting-started/')).toBe('/en/getting-started/');
    expect(resolveFrom('content/guide/cli.md', '../README.md')).toBe('/en/');
  });

  it('routes package docs with the locale prefix', () => {
    expect(resolveFrom('content/guide/cli.md', '../../packages/agent-core/docs/SPEC.md')).toBe(
      '/en/packages/agent-core/SPEC/',
    );
    expect(resolveFrom('content/guide/cli.md', '../../packages/agent-core/docs/README.md', 'ko')).toBe(
      '/ko/packages/agent-core/',
    );
    expect(resolveFrom('packages/agent-core/docs/README.md', './SPEC.md#contract')).toBe(
      '/en/packages/agent-core/SPEC/#contract',
    );
  });

  it('keeps the page locale, and sends links into content/ko to the Korean page', () => {
    expect(resolveFrom('content/ko/getting-started/README.md', '../../guide/cli.md', 'ko')).toBe(
      '/ko/guide/cli/',
    );
    expect(resolveFrom('content/getting-started/README.md', '../ko/getting-started/README.md')).toBe(
      '/ko/getting-started/',
    );
  });

  it('sends files the site does not render to GitHub', () => {
    expect(resolveFrom('content/guide/cli.md', '../../packages/agent-core/README.md')).toBe(
      `${GITHUB_BLOB_BASE}/packages/agent-core/README.md`,
    );
    expect(resolveFrom('content/guide/cli.md', '../../packages/agent-core/src/index.ts')).toBe(
      `${GITHUB_BLOB_BASE}/packages/agent-core/src/index.ts`,
    );
    expect(resolveFrom('content/guide/cli.md', '../../examples/express')).toBe(
      `${GITHUB_TREE_BASE}/examples/express`,
    );
    expect(resolveFrom('content/guide/cli.md', '../v2.0.0/README.md')).toBe(
      `${GITHUB_BLOB_BASE}/content/v2.0.0/README.md`,
    );
    expect(resolveFrom('packages/dag-nodes/docs/README.md', '../llm-text/docs/README.md')).toBe(
      `${GITHUB_BLOB_BASE}/packages/dag-nodes/llm-text/docs/README.md`,
    );
  });

  it('adds the locale to absolute site paths written without one', () => {
    expect(resolveFrom('content/README.md', '/guide', 'ko')).toBe('/ko/guide/');
    expect(resolveFrom('content/README.md', '/en/guide/')).toBe('/en/guide/');
    expect(resolveFrom('content/README.md', '/schemas/keybindings.schema.json')).toBe(
      '/schemas/keybindings.schema.json',
    );
  });

  it('leaves external, anchor-only and missing targets unchanged', () => {
    expect(resolveFrom('content/guide/cli.md', 'https://example.com/a.md')).toBe(
      'https://example.com/a.md',
    );
    expect(resolveFrom('content/guide/cli.md', 'mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(resolveFrom('content/guide/cli.md', '#options')).toBe('#options');
    expect(resolveFrom('content/guide/cli.md', './missing.md')).toBe('./missing.md');
  });
});

describe('resolveDocImage', () => {
  function imageFrom(sourceRel: string, src: string): string {
    return resolveDocImage(src, { sourcePath: path.join(repoRoot, sourceRel), locale: 'en', repoRoot });
  }

  it('serves a relative image from GitHub raw content, resolved against the source file', () => {
    expect(imageFrom('packages/agent-core/docs/README.md', '../../agent-cli/docs/demo.gif')).toBe(
      `${GITHUB_RAW_BASE}/packages/agent-cli/docs/demo.gif`,
    );
  });

  it('leaves absolute, external and missing images unchanged', () => {
    expect(imageFrom('content/README.md', 'https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(imageFrom('content/README.md', '/favicon.svg')).toBe('/favicon.svg');
    expect(imageFrom('content/README.md', './missing.png')).toBe('./missing.png');
  });
});
