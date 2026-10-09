import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { getFilePath, getPageContent, MONOREPO_ROOT } from './content';
import { generateLlmDocuments, rewriteLlmMarkdown } from './llms';
import { buildSidebar, type SidebarItem } from './sidebar';

const identity = {
  displayName: 'Fixture',
  docsUrl: 'https://docs.example.test/reference/',
  repositoryUrl: 'https://github.com/example/project.git',
};

function englishContentFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['ko', 'images', 'v2.0.0'].includes(entry.name) ? [] : englishContentFiles(target);
    }
    return entry.name.endsWith('.md') ? [target] : [];
  });
}

function sidebarHrefs(items: SidebarItem[]): string[] {
  return items.flatMap((item) => [item.href, ...sidebarHrefs(item.children ?? [])]);
}

describe('generated agent documentation', () => {
  it('keeps the curated map, rewrites its links and lists every English page once', async () => {
    const documents = await generateLlmDocuments(identity);
    expect(documents).not.toBeNull();
    const { index, pages } = documents!;
    const root = fs.readFileSync(path.join(MONOREPO_ROOT, 'llms.txt'), 'utf8');
    expect(index.split('\n')[0]).toBe(root.split('\n')[0]);
    for (const heading of [
      'Minimal embedding set',
      'Capabilities',
      'Behavior contracts',
      'Types & examples',
    ]) {
      expect(index).toContain(`## ${heading}`);
    }
    expect(index).toContain('https://github.com/example/project/blob/HEAD/VISION.md');
    expect(index).toContain('https://github.com/example/project/tree/HEAD/examples/express');
    expect(index).toContain('https://docs.example.test/reference/en/guide/providers/');
    expect(index).not.toMatch(/\]\((?:content|packages|examples)\//u);
    expect(index).toContain('https://docs.example.test/reference/llms-full.txt');

    const files = englishContentFiles(path.join(MONOREPO_ROOT, 'content')).sort();
    expect(pages.map((page) => page.filePath).sort()).toEqual(files);
    const docsSection = index.split('\n## Docs\n')[1].split('\n## Optional\n')[0];
    const listedUrls = [...docsSection.matchAll(/^- \[.*?\]\((.*?)\)/gmu)].map((match) => match[1]);
    expect(new Set(listedUrls).size).toBe(files.length);
    expect(listedUrls).toEqual(pages.map((page) => page.url));
    expect(listedUrls.every((url) => url.startsWith(`${identity.docsUrl}en/`))).toBe(true);
    expect(listedUrls).toContain(`${identity.docsUrl}en/quickstart/`);
    expect(listedUrls).toContain(`${identity.docsUrl}en/integrations/github-action/`);
    expect(index).toContain(
      'All supported AI providers, their configuration options, and how to swap between them.',
    );
  });

  it('includes complete page bodies and source URLs in sidebar order without package or Korean pages', async () => {
    const { full, pages } = (await generateLlmDocuments(identity))!;
    const actualHrefs = pages.map((page) =>
      `/en/${page.slug.length ? `${page.slug.join('/')}` : ''}`.replace(/\/$/u, ''),
    );
    const expectedHrefs = sidebarHrefs(buildSidebar('en')).filter((href) =>
      actualHrefs.includes(href),
    );
    expect(actualHrefs[0]).toBe('/en');
    expect(actualHrefs.slice(1, expectedHrefs.length + 1)).toEqual(expectedHrefs);
    let previous = -1;
    for (const page of pages) {
      const marker = `## ${page.title}\n\nSource: <${page.url}>`;
      const offset = full.indexOf(marker);
      expect(offset).toBeGreaterThan(previous);
      previous = offset;
      const source = await getPageContent(page.slug, 'en');
      expect(full).toContain(rewriteLlmMarkdown(source!.source, source!.filePath, identity).trim());
      expect(page.filePath).not.toContain(`${path.sep}ko${path.sep}`);
      expect(page.filePath).not.toContain(`${path.sep}packages${path.sep}`);
    }
    expect(full).toContain('https://docs.example.test/reference/en/packages/');
    expect(full).toContain('https://docs.example.test/reference/en/guide/local-llm/');
  }, 30_000);

  it('rewrites reference links and directory indexes while retaining external URLs, fragments and code', () => {
    const sourcePath = getFilePath(['guide', 'providers'])!;
    const markdown =
      '# Links\n\n[Guide][guide], [directory](../getting-started/), [repo](../../VISION.md#direction), [external](https://example.test/a?q=1#b), [anchor](#local).\n\n[guide]: ../getting-started/README.md#first-step\n\n```md\n[sample](../../not-a-real-file.md)\n```\n';
    const output = rewriteLlmMarkdown(markdown, sourcePath, identity, true);
    expect(output).toContain(`${identity.docsUrl}en/getting-started/#first-step`);
    expect(output).toContain(`[directory](${identity.docsUrl}en/getting-started/)`);
    expect(output).toContain('https://github.com/example/project/blob/HEAD/VISION.md#direction');
    expect(output).toContain('https://example.test/a?q=1#b');
    expect(output).toContain('[anchor](#local)');
    expect(output).toContain('[sample](../../not-a-real-file.md)');
  });

  it('refuses drift in curated repository links', () => {
    expect(() =>
      rewriteLlmMarkdown(
        '[missing](packages/not-a-real-package/README.md)',
        path.join(MONOREPO_ROOT, 'llms.txt'),
        identity,
        true,
      ),
    ).toThrow(/does not exist/u);
  });

  it('omits repository hyperlinks when that optional identity is absent', async () => {
    const docsOnly = { displayName: 'Fixture', docsUrl: identity.docsUrl };
    const documents = (await generateLlmDocuments(docsOnly))!;
    expect(documents.index).toContain('packages/agent-core/README.md');
    expect(documents.index).not.toContain('github.com');
    expect(documents.index).toContain(`${identity.docsUrl}en/guide/providers/`);
    const rewritten = rewriteLlmMarkdown(
      '[direct](VISION.md) and [reference][owner]\n\n[owner]: VISION.md\n',
      path.join(MONOREPO_ROOT, 'llms.txt'),
      docsOnly,
      true,
    );
    expect(rewritten.trim()).toBe('direct and reference');
  });

  it('has no documents without a documentation URL', async () => {
    expect(await generateLlmDocuments({ displayName: 'Fixture' })).toBeNull();
  });
});
