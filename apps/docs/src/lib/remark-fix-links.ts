/**
 * Remark plugin: fix VitePress-style .md links for Next.js routing.
 *
 * Transforms:
 *   ./architecture.md              → ./architecture
 *   ../guide/building-agents.md    → ../guide/building-agents
 *   ./guide/README.md              → ./guide
 *   ../../packages/X/docs/Y.md    → /packages/X/Y  (absolute)
 *
 * External links (http/https) and anchor-only links (#) are left unchanged.
 */
import type { IMdastNode } from './mdast-types';

export function remarkFixLinks() {
  return (tree: IMdastNode) => {
    walkLinks(tree);
  };
}

function walkLinks(node: IMdastNode): void {
  if (node.type === 'link') {
    fixHref(node);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkLinks(child);
  }
}

function fixHref(node: IMdastNode): void {
  const href: string = node.url ?? '';

  // Skip: external, anchor-only, or no .md
  if (!href || href.startsWith('http') || href.startsWith('#') || !href.includes('.md')) return;

  // Separate hash fragment if present
  const hashIdx = href.indexOf('#');
  const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : '';

  if (!base.endsWith('.md')) return;

  // packages/*/docs/FILE.md → absolute /packages/*/FILE
  const pkgMatch = base.match(/(?:\.\.\/)*packages\/([^/]+)\/docs\/(.+)\.md$/);
  if (pkgMatch) {
    node.url = `/packages/${pkgMatch[1]}/${pkgMatch[2]}${hash}`;
    return;
  }

  // Remove .md extension
  let fixed = base.slice(0, -3); // drop '.md'

  // /README or README (no leading slash) → parent dir
  if (fixed.endsWith('/README')) {
    fixed = fixed.slice(0, -'/README'.length) || '.';
  } else if (fixed === 'README') {
    fixed = '.';
  }

  node.url = fixed + hash;
}
