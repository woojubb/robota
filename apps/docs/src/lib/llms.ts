import fs from 'fs';
import path from 'path';
import type { Parent, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import { extractTitle, getAllSlugs, getFilePath, getPageContent, MONOREPO_ROOT } from './content';
import { firstParagraph } from './packages-index';
import { productPublicConfig } from './product-config.generated';
import type { IProductPublicConfig } from './product-config.types';
import { buildSidebar, type SidebarItem } from './sidebar';

type TIdentity = IProductPublicConfig['identity'];

interface ILlmPage {
  slug: string[];
  filePath: string;
  title: string;
  description: string;
  url: string;
  source: string;
}

interface ILinkContext {
  identity: TIdentity;
  sourcePath: string;
  strict: boolean;
  routes: Set<string>;
  contentRoutes: Map<string, string[]>;
}

const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkStringify);

function publishedRoutes(): Pick<ILinkContext, 'routes' | 'contentRoutes'> {
  const routes = new Set<string>();
  const contentRoutes = new Map<string, string[]>();
  for (const slug of getAllSlugs()) {
    routes.add(slug.join('/'));
    const filePath = getFilePath(slug, 'en');
    if (filePath && path.relative(MONOREPO_ROOT, filePath).startsWith(`content${path.sep}`)) {
      contentRoutes.set(filePath, slug);
    }
  }
  return { routes, contentRoutes };
}

function docsUrl(identity: TIdentity, route: string): string {
  return `${identity.docsUrl!.replace(/\/+$/u, '')}/${route}`;
}

function encodedPath(segments: string[]): string {
  return segments.map(encodeURIComponent).join('/');
}

function resolveLink(href: string, context: ILinkContext): string | null {
  if (!href || /^(?:#|[a-z][a-z0-9+.-]*:|\/\/)/iu.test(href)) return href;
  const [, base, suffix] = /^([^?#]*)(.*)$/u.exec(href)!;
  const decoded = decodeURIComponent(base);

  // Site-root links such as /packages/ already name a published route.
  if (decoded.startsWith('/')) {
    const locale = decoded.startsWith('/ko/') ? 'ko' : 'en';
    const slug = decoded.replace(/^\/(?:en|ko)(?:\/|$)/u, '/').replace(/^\/|\/$/gu, '');
    if (context.routes.has(slug)) {
      return `${docsUrl(context.identity, `${locale}/${slug ? `${encodedPath(slug.split('/'))}/` : ''}`)}${suffix}`;
    }
  }

  const target = path.resolve(
    base.startsWith('/') ? MONOREPO_ROOT : path.dirname(context.sourcePath),
    decoded.replace(/^\/+/, ''),
  );
  const relative = path.relative(MONOREPO_ROOT, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Documentation link escapes the repository: ${href}`);
  }
  if (!fs.existsSync(target)) {
    if (context.strict)
      throw new Error(`Documentation link does not exist: ${href} in ${context.sourcePath}`);
    return href;
  }
  const isDirectory = fs.statSync(target).isDirectory();
  const slug = context.contentRoutes.get(isDirectory ? path.join(target, 'README.md') : target);
  if (slug) {
    return `${docsUrl(context.identity, `en/${slug.length ? `${encodedPath(slug)}/` : ''}`)}${suffix}`;
  }
  const repository = context.identity.repositoryUrl?.replace(/\/+$/u, '').replace(/\.git$/u, '');
  if (!repository) return null;
  return `${repository}/${isDirectory ? 'tree' : 'blob'}/HEAD/${encodedPath(relative.split(path.sep))}${suffix}`;
}

function rewriteMarkdown(source: string, context: ILinkContext): string {
  const tree: Root = markdown.parse(source);
  const omittedDefinitions = new Set<string>();
  function rewriteDefinitions(parent: Parent): void {
    for (const child of parent.children) {
      if (child.type === 'definition') {
        const url = resolveLink(child.url, context);
        if (url === null) omittedDefinitions.add(child.identifier);
        else child.url = url;
      } else if ('children' in child) rewriteDefinitions(child);
    }
  }
  rewriteDefinitions(tree);
  function rewriteChildren(parent: Parent): void {
    parent.children = parent.children.flatMap((child): Parent['children'] => {
      if (child.type === 'definition' && omittedDefinitions.has(child.identifier)) return [];
      if (child.type === 'link' || child.type === 'image') {
        const url = resolveLink(child.url, context);
        if (url === null) {
          return child.type === 'link'
            ? child.children
            : [{ type: 'text', value: child.alt ?? '' }];
        }
        child.url = url;
      } else if (
        (child.type === 'linkReference' || child.type === 'imageReference') &&
        omittedDefinitions.has(child.identifier)
      ) {
        return child.type === 'linkReference'
          ? child.children
          : [{ type: 'text', value: child.alt ?? '' }];
      }
      if ('children' in child) rewriteChildren(child);
      return [child];
    });
  }
  rewriteChildren(tree);
  return markdown.stringify(tree);
}

/** Rewrite Markdown destinations without inspecting or changing code examples. */
export function rewriteLlmMarkdown(
  source: string,
  sourcePath: string,
  identity: TIdentity,
  strict: boolean = false,
): string {
  return rewriteMarkdown(source, { identity, sourcePath, strict, ...publishedRoutes() });
}

function sidebarSlugs(items: SidebarItem[]): string[] {
  return items.flatMap((item) => [
    item.href.slice('/en/'.length),
    ...sidebarSlugs(item.children ?? []),
  ]);
}

function linkLabel(value: string): string {
  return value.replace(/\s+/gu, ' ').replace(/[\\[\]]/gu, '\\$&');
}

/** Derive both static documents from the curated root and the site's English content loader. */
export async function generateLlmDocuments(identity: TIdentity = productPublicConfig.identity) {
  if (!identity.docsUrl) return null;
  const published = publishedRoutes();
  const bySlug = new Map(
    [...published.contentRoutes].map(([filePath, slug]) => [slug.join('/'), { filePath, slug }]),
  );
  const order = [
    ...new Set(['', ...sidebarSlugs(buildSidebar('en')), ...[...bySlug.keys()].sort()]),
  ].filter((slug) => bySlug.has(slug));
  const pages: ILlmPage[] = await Promise.all(
    order.map(async (key) => {
      const { slug, filePath } = bySlug.get(key)!;
      const page = (await getPageContent(slug, 'en'))!;
      return {
        slug,
        filePath,
        title: extractTitle(page.source, page.frontmatter),
        description: firstParagraph(page.frontmatter.description || page.source),
        url: docsUrl(identity, `en/${slug.length ? `${encodedPath(slug)}/` : ''}`),
        source: page.source,
      };
    }),
  );
  const rootPath = path.join(MONOREPO_ROOT, 'llms.txt');
  const curated = rewriteMarkdown(fs.readFileSync(rootPath, 'utf8'), {
    identity,
    sourcePath: rootPath,
    strict: true,
    ...published,
  });
  const index = `${curated.trimEnd()}\n\n## Docs\n\n${pages.map((page) => `- [${linkLabel(page.title)}](${page.url})${page.description ? `: ${page.description}` : ''}`).join('\n')}\n\n## Optional\n\n- [Full English documentation](${docsUrl(identity, 'llms-full.txt')}): All English content pages in one Markdown document.\n`;
  const full = `# ${identity.displayName} documentation\n\n${pages.map((page) => `## ${page.title}\n\nSource: <${page.url}>\n\n${rewriteMarkdown(page.source, { identity, sourcePath: page.filePath, strict: false, ...published }).trim()}`).join('\n\n')}\n`;
  return { index, full, pages };
}
