import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// process.cwd() in Next.js build = apps/docs/
// monorepo root is 2 levels up
const MONOREPO_ROOT = path.join(process.cwd(), '..', '..');
const CONTENT_DIR = path.join(MONOREPO_ROOT, 'content');
const PACKAGES_DIR = path.join(MONOREPO_ROOT, 'packages');

const EXCLUDED_DIRS = new Set(['v2.0.0', 'api-reference', 'images', 'ko']);

/** Recursively collect all .md files under a directory, returning paths relative to that dir. */
function collectMarkdownFiles(dir: string, base: string = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      results.push(...collectMarkdownFiles(path.join(dir, entry.name), relative));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(relative);
    }
  }
  return results;
}

/**
 * Convert a file path (relative to content/) into a slug array.
 * README.md at root → []
 * guide/README.md → ['guide']
 * guide/cli.md → ['guide', 'cli']
 */
function filePathToSlug(filePath: string): string[] {
  const parts = filePath.split('/');
  // Remove .md extension from last part
  const last = parts[parts.length - 1].replace(/\.md$/, '');
  if (last === 'README') {
    // directory index: drop the filename
    return parts.slice(0, -1);
  }
  return [...parts.slice(0, -1), last];
}

/** Return all slug arrays from content/ and packages pkg docs dirs */
export function getAllSlugs(): string[][] {
  const slugs: string[][] = [];

  // content/ files
  const contentFiles = collectMarkdownFiles(CONTENT_DIR);
  for (const file of contentFiles) {
    const slug = filePathToSlug(file);
    slugs.push(slug);
  }

  // packages/*/docs/ files — route as packages/<pkgname>/<file>
  if (fs.existsSync(PACKAGES_DIR)) {
    const pkgDirs = fs
      .readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const pkg of pkgDirs) {
      const docsDir = path.join(PACKAGES_DIR, pkg, 'docs');
      if (!fs.existsSync(docsDir)) continue;
      const files = collectMarkdownFiles(docsDir);
      for (const file of files) {
        const fileStem = file.replace(/\.md$/, '');
        if (fileStem === 'README') {
          slugs.push(['packages', pkg]);
        } else {
          const parts = file.split('/');
          const last = parts[parts.length - 1].replace(/\.md$/, '');
          slugs.push(['packages', pkg, ...parts.slice(0, -1), last]);
        }
      }
    }
  }

  return slugs;
}

/**
 * Resolve a slug array to an absolute file path, locale-aware.
 * For locale='ko': tries content/ko/{slug} first, falls back to content/{slug}.
 * For locale='en' or default: uses content/{slug}.
 */
export function getFilePath(slug: string[], locale: string = 'en'): string | null {
  if (slug.length === 0) {
    if (locale === 'ko') {
      const p = path.join(CONTENT_DIR, 'ko', 'README.md');
      if (fs.existsSync(p)) return p;
    }
    const p = path.join(CONTENT_DIR, 'README.md');
    return fs.existsSync(p) ? p : null;
  }

  // packages/* route — no locale support for now (always English)
  if (slug[0] === 'packages') {
    const pkgName = slug[1];
    if (!pkgName) return null;
    const docsDir = path.join(PACKAGES_DIR, pkgName, 'docs');
    if (slug.length === 2) {
      const p = path.join(docsDir, 'README.md');
      return fs.existsSync(p) ? p : null;
    }
    const rest = slug.slice(2);
    const direct = path.join(docsDir, ...rest) + '.md';
    if (fs.existsSync(direct)) return direct;
    const readme = path.join(docsDir, ...rest, 'README.md');
    if (fs.existsSync(readme)) return readme;
    return null;
  }

  // content/* route — locale-aware
  if (locale === 'ko') {
    const koDir = path.join(CONTENT_DIR, 'ko');
    const koDirect = path.join(koDir, ...slug) + '.md';
    if (fs.existsSync(koDirect)) return koDirect;
    const koReadme = path.join(koDir, ...slug, 'README.md');
    if (fs.existsSync(koReadme)) return koReadme;
  }

  // English fallback (or en locale)
  const directPath = path.join(CONTENT_DIR, ...slug) + '.md';
  if (fs.existsSync(directPath)) return directPath;

  const readmePath = path.join(CONTENT_DIR, ...slug, 'README.md');
  if (fs.existsSync(readmePath)) return readmePath;

  return null;
}

export interface PageContent {
  source: string;
  frontmatter: Record<string, string>;
  filePath: string;
}

/** Read and parse a page by slug, returning stripped markdown source + frontmatter. */
export async function getPageContent(
  slug: string[],
  locale: string = 'en',
): Promise<PageContent | null> {
  const filePath = getFilePath(slug, locale);
  if (!filePath) return null;

  const raw = fs.readFileSync(filePath, 'utf8');
  const { content, data } = matter(raw);

  return {
    source: content,
    frontmatter: data as Record<string, string>,
    filePath,
  };
}

/** Extract a readable title from frontmatter or first H1 heading. */
export function extractTitle(source: string, frontmatter: Record<string, string>): string {
  if (frontmatter.title) return frontmatter.title as string;
  const match = source.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}
