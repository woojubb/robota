import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const MONOREPO_ROOT = path.join(process.cwd(), '..', '..');
const CONTENT_DIR = path.join(MONOREPO_ROOT, 'content');
const PACKAGES_DIR = path.join(MONOREPO_ROOT, 'packages');

const EXCLUDED_DIRS = new Set(['v2.0.0', 'images', 'ko']);

export interface SidebarItem {
  title: string;
  href: string;
  children?: SidebarItem[];
}

const GUIDE_ORDER = [
  'README',
  'architecture',
  'building-agents',
  'sdk',
  'cli',
  'local-llm',
  'providers',
  'embedding',
  'permissions-and-hooks',
  'context-management',
  'error-handling',
  'plugins',
  'migration',
];

/** Read the title from a markdown file (frontmatter > first H1 > filename). */
function readTitle(filePath: string, fallback: string): string {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(raw);
    if (data.title) return data.title as string;
    const h1 = content.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
  } catch {
    // ignore
  }
  return fallback;
}

/**
 * Read title with locale fallback: try ko/ first, then en.
 */
function readTitleLocaleAware(
  contentPath: string,
  locale: string,
  fallback: string,
  subPath: string,
): string {
  if (locale === 'ko') {
    const koPath = path.join(CONTENT_DIR, 'ko', subPath);
    if (fs.existsSync(koPath)) return readTitle(koPath, fallback);
  }
  return readTitle(contentPath, fallback);
}

/** List markdown files in a directory (non-recursive, returns stems). */
function listMarkdownStems(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name.replace(/\.md$/, ''));
}

/** Build items for a flat section directory. README.md becomes the section index. */
function buildSectionItems(
  dir: string,
  prefix: string,
  locale: string,
  order?: string[],
): SidebarItem[] {
  const stems = listMarkdownStems(dir);

  let sorted: string[];
  if (order) {
    const ordered = order.filter((s) => stems.includes(s));
    const rest = stems.filter((s) => !order.includes(s)).sort();
    sorted = [...ordered, ...rest];
  } else {
    sorted = stems.sort();
  }

  const items: SidebarItem[] = [];
  for (const stem of sorted) {
    if (stem === 'README') continue;
    const filePath = path.join(dir, stem + '.md');
    const sectionName = path.basename(dir);
    const title = readTitleLocaleAware(filePath, locale, stem, `${sectionName}/${stem}.md`);
    items.push({ title, href: `${prefix}/${stem}` });
  }
  return items;
}

/** Build sidebar section for a content/ subdirectory. */
function buildSection(
  name: string,
  title: string,
  hrefPrefix: string,
  locale: string,
  order?: string[],
): SidebarItem {
  const dir = path.join(CONTENT_DIR, name);
  const readmePath = path.join(dir, 'README.md');
  const sectionTitle = readTitleLocaleAware(readmePath, locale, title, `${name}/README.md`);
  const children = buildSectionItems(dir, hrefPrefix, locale, order);
  return {
    title: sectionTitle,
    href: hrefPrefix,
    ...(children.length > 0 ? { children } : {}),
  };
}

/** Build package sidebar items from packages pkg docs dirs */
function buildPackagesSection(): SidebarItem {
  const children: SidebarItem[] = [];

  if (!fs.existsSync(PACKAGES_DIR)) {
    return { title: 'Packages', href: '/packages' };
  }

  const pkgDirs = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !EXCLUDED_DIRS.has(e.name))
    .map((e) => e.name)
    .sort();

  for (const pkg of pkgDirs) {
    const docsDir = path.join(PACKAGES_DIR, pkg, 'docs');
    if (!fs.existsSync(docsDir)) continue;

    const readmePath = path.join(docsDir, 'README.md');
    const title = readTitle(readmePath, pkg);
    const pkgHref = `/packages/${pkg}`;

    const stems = listMarkdownStems(docsDir)
      .filter((s) => s !== 'README')
      .sort();
    const pkgChildren: SidebarItem[] = stems.map((stem) => {
      const filePath = path.join(docsDir, stem + '.md');
      const itemTitle = readTitle(filePath, stem);
      return { title: itemTitle, href: `${pkgHref}/${stem}` };
    });

    children.push({
      title,
      href: pkgHref,
      ...(pkgChildren.length > 0 ? { children: pkgChildren } : {}),
    });
  }

  return { title: 'Packages', href: '/packages', children };
}

/** Build the full sidebar tree, locale-aware. */
export function buildSidebar(locale: string = 'en'): SidebarItem[] {
  return [
    buildSection('getting-started', 'Getting Started', '/getting-started', locale),
    buildSection('guide', 'Guide', '/guide', locale, GUIDE_ORDER),
    buildSection('examples', 'Examples', '/examples', locale),
    buildPackagesSection(),
    buildSection('changelog', 'Changelog', '/changelog', locale),
    buildSection('development', 'Development', '/development', locale),
    buildSection('plugins', 'Plugins', '/plugins', locale),
  ];
}
