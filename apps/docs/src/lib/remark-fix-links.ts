/**
 * Remark plugin: turn repo-relative Markdown links into links that work on the docs site.
 *
 * Docs are written with links relative to their own file (`../guide/cli.md`,
 * `../../packages/agent-core/docs/SPEC.md`) so they also work on GitHub. The site serves pages at
 * `/<locale>/<route>/` with a trailing slash, so a relative href in the rendered HTML would resolve
 * against the page URL, not the source file. Every relative link is therefore resolved against the
 * source file here and emitted as an absolute URL:
 *
 *   target rendered by the site  → /<locale>/<route>/       (content/**, packages/<pkg>/docs/**)
 *   any other file in the repo   → GitHub blob/tree URL      (source files, examples, root docs)
 *   absolute site path w/o locale → /<locale><path>          (e.g. `/guide/cli`)
 *
 * External links, anchor-only links and links whose target does not exist are left unchanged.
 */
import fs from 'fs';
import path from 'path';

import type { IMdastNode } from './mdast-types';

export const GITHUB_BLOB_BASE = 'https://github.com/woojubb/robota/blob/main';
export const GITHUB_TREE_BASE = 'https://github.com/woojubb/robota/tree/main';

/** Content directories the site does not render as routes. */
const UNROUTED_CONTENT_DIRS = new Set(['v2.0.0', 'images']);
const LOCALE_PREFIX = /^\/(en|ko)(\/|$)/;

export interface IRemarkFixLinksOptions {
  /** Absolute path of the Markdown file being rendered. */
  sourcePath: string;
  /** Locale of the page being rendered; site links keep the reader in it. */
  locale: string;
  /** Absolute path of the monorepo root. */
  repoRoot: string;
}

export function remarkFixLinks(options: IRemarkFixLinksOptions) {
  return (tree: IMdastNode) => {
    walkLinks(tree, options);
  };
}

function walkLinks(node: IMdastNode, options: IRemarkFixLinksOptions): void {
  if (node.type === 'link' && node.url) {
    node.url = resolveDocLink(node.url, options);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkLinks(child, options);
  }
}

/** Resolve one href written in `options.sourcePath` to the URL the site should emit. */
export function resolveDocLink(href: string, options: IRemarkFixLinksOptions): string {
  if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
    return href;
  }

  const hashIdx = href.indexOf('#');
  const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : '';

  if (base.startsWith('/')) {
    if (LOCALE_PREFIX.test(base) || path.extname(base) !== '') return href;
    return `/${options.locale}${withTrailingSlash(base)}${hash}`;
  }

  let decoded: string;
  try {
    decoded = decodeURI(base);
  } catch {
    return href;
  }
  const target = path.resolve(path.dirname(options.sourcePath), decoded);
  const relToRoot = path.relative(options.repoRoot, target);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot) || !fs.existsSync(target)) {
    return href;
  }

  const parts = relToRoot.split(path.sep);
  const route = siteRoute(parts, target);
  if (route !== null) {
    // A link into content/ko/ always means the Korean page.
    const locale = parts[0] === 'content' && parts[1] === 'ko' ? 'ko' : options.locale;
    return `/${locale}${route}${hash}`;
  }

  const isDir = fs.statSync(target).isDirectory();
  const repoPath = parts.join('/');
  return `${isDir ? GITHUB_TREE_BASE : GITHUB_BLOB_BASE}/${repoPath}${hash}`;
}

/**
 * The site route (with leading and trailing slash, no locale) for a repo path, or null when the
 * site does not render that path.
 */
function siteRoute(parts: string[], absolutePath: string): string | null {
  const isDir = fs.statSync(absolutePath).isDirectory();

  if (parts[0] === 'content') {
    let rest = parts.slice(1);
    if (rest[0] === 'ko') rest = rest.slice(1);
    if (rest.length > 0 && UNROUTED_CONTENT_DIRS.has(rest[0])) return null;
    return pageRoute(rest, isDir, absolutePath);
  }

  // packages/<pkg>/docs/** — only direct children of packages/ are routed.
  if (parts[0] === 'packages' && parts[2] === 'docs' && parts.length >= 3) {
    const route = pageRoute(parts.slice(3), isDir, absolutePath);
    return route === null ? null : `/packages/${parts[1]}${route}`;
  }

  return null;
}

/** Route for a path inside a routed directory: `a/b.md` → `/a/b/`, `a/README.md` or `a/` → `/a/`. */
function pageRoute(rest: string[], isDir: boolean, absolutePath: string): string | null {
  if (isDir) {
    if (!fs.existsSync(path.join(absolutePath, 'README.md'))) return null;
    return withTrailingSlash(`/${rest.join('/')}`);
  }
  const last = rest[rest.length - 1] ?? '';
  if (!last.endsWith('.md')) return null;
  const stem = last.slice(0, -'.md'.length);
  const segments = stem === 'README' ? rest.slice(0, -1) : [...rest.slice(0, -1), stem];
  return withTrailingSlash(`/${segments.join('/')}`);
}

function withTrailingSlash(p: string): string {
  return p.endsWith('/') ? p : `${p}/`;
}
