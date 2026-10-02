import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  getAllSlugs,
  getPageContent,
  extractTitle,
  MONOREPO_ROOT,
  PACKAGES_DIR,
} from '@/lib/content';
import { buildPackageIndex } from '@/lib/packages-index';
import { buildSidebar } from '@/lib/sidebar';
import { extractToc } from '@/lib/toc';
import { remarkMermaid } from '@/lib/remark-mermaid';
import { remarkFixLinks } from '@/lib/remark-fix-links';
import { DocsLayout } from '@/components/DocsLayout';
import { PackagesIndex } from '@/components/PackagesIndex';
import { CodeBlock } from '@/components/mdx/CodeBlock';
import { MermaidDiagram } from '@/components/mdx/MermaidDiagram';
import { Callout } from '@/components/mdx/Callout';
import { PackageManagerTabs } from '@/components/mdx/PackageManagerTabs';

const components = {
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <CodeBlock {...props}>{children}</CodeBlock>
  ),
  MermaidDiagram,
  Callout,
  PackageManagerTabs,
};

function isPackagesIndex(slug: string[]): boolean {
  return slug.length === 1 && slug[0] === 'packages';
}

interface PageParams {
  locale: string;
  slug?: string[];
}

export async function generateStaticParams(): Promise<PageParams[]> {
  const slugs = getAllSlugs();
  const locales = ['en', 'ko'];
  const result: PageParams[] = [];
  for (const locale of locales) {
    for (const slug of slugs) {
      result.push({ locale, slug: slug.length === 0 ? undefined : slug });
    }
  }
  return result;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { slug, locale } = await params;
  const resolvedSlug = slug ?? [];
  if (isPackagesIndex(resolvedSlug)) {
    return { title: 'Packages', description: 'Every __PRODUCT_DISPLAY_NAME__ SDK package and its documentation.' };
  }
  const page = await getPageContent(resolvedSlug, locale);
  if (!page) return { title: 'Not Found' };

  const title = extractTitle(page.source, page.frontmatter);
  const description =
    (page.frontmatter.description as string | undefined) ??
    page.source.replace(/^#.*$/m, '').trim().slice(0, 160).replace(/\s+/g, ' ');

  return { title, description };
}

const QUICK_LINK_DESCS: Record<string, string> = {
  'getting-started': 'Install, configure a provider and run your first agent',
  guide: 'Architecture, SDK, CLI, sessions, MCP, permissions and more',
  examples: 'Focused walkthroughs for common tasks',
  packages: 'Every package, its role and its contract',
  changelog: 'Release notes and version history',
  development: 'Contributing guide and development setup',
};

interface HomePageProps {
  badge: string;
  title: string;
  titleHighlight: string;
  description: string;
  getStarted: string;
  readGuide: string;
  quickInstall: string;
  navLabels: Record<string, string>;
}

function HomePage({
  badge,
  title,
  titleHighlight,
  description,
  getStarted,
  readGuide,
  quickInstall,
  navLabels,
}: HomePageProps) {
  const QUICK_LINKS = [
    { key: 'gettingStarted', href: 'getting-started', tag: '01' },
    { key: 'guide', href: 'guide', tag: '02' },
    { key: 'examples', href: 'examples', tag: '03' },
    { key: 'packages', href: 'packages', tag: '04' },
    { key: 'changelog', href: 'changelog', tag: '05' },
    { key: 'development', href: 'development', tag: '06' },
  ];

  return (
    <div>
      {/* Hero */}
      <div className="mb-12 border-b border-border pb-10">
        <div className="mb-6 inline-flex items-center gap-1.5 rounded border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] bg-[var(--primary-dim)] px-2.5 py-[0.2rem] [font-family:var(--font-code)] text-[0.72rem] tracking-[0.06em] text-primary">
          <span className="opacity-60">$</span> {badge}
        </div>

        <h1 className="mb-[1.125rem] [font-family:var(--font-display)] text-[2.25rem] font-bold leading-[1.12] tracking-[-0.025em] text-[var(--foreground-hi)]">
          {title}
          <br />
          <span className="text-primary [text-shadow:0_0_32px_color-mix(in_srgb,var(--accent)_25%,transparent)]">
            {titleHighlight}
          </span>
        </h1>

        <p className="mb-7 max-w-[52ch] [font-family:var(--font-body)] text-[1rem] leading-[1.75] text-muted-foreground">
          {description}
        </p>

        <div className="flex flex-wrap gap-3">
          {/* Hero CTAs — min-h-11 keeps the primary tap targets at >= 44px (DOCS-002) */}
          <a
            href="getting-started"
            className="inline-flex min-h-11 items-center gap-1.5 rounded bg-primary px-5 [font-family:var(--font-display)] text-[0.85rem] font-semibold tracking-[0.02em] text-[var(--primary-foreground)] no-underline shadow-[0_0_24px_color-mix(in_srgb,var(--accent)_20%,transparent)] transition-shadow"
          >
            {getStarted}
          </a>
          <a
            href="guide"
            className="inline-flex min-h-11 items-center gap-1.5 rounded border border-[var(--border-strong)] bg-transparent px-5 [font-family:var(--font-display)] text-[0.85rem] font-medium tracking-[0.02em] text-foreground no-underline transition-colors hover:border-[var(--foreground-hi)]"
          >
            {readGuide}
          </a>
        </div>
      </div>

      {/* Quick links grid */}
      <section aria-labelledby="docs-sections-heading" className="mb-12">
        <h2
          id="docs-sections-heading"
          className="mx-0 mb-3.5 mt-0 [font-family:var(--font-display)] text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
        >
          Explore the docs
        </h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {QUICK_LINKS.map((card) => (
            <a
              key={card.href}
              href={card.href}
              className="relative block overflow-hidden rounded-[0.375rem] border border-border bg-card p-[1.125rem] no-underline transition-[border-color,background] duration-200"
            >
              <span className="absolute right-3.5 top-3 select-none [font-family:var(--font-code)] text-[0.65rem] tracking-[0.04em] text-[color-mix(in_srgb,var(--accent)_25%,transparent)]">
                {card.tag}
              </span>
              <h3 className="mx-0 mb-1.5 mt-0 [font-family:var(--font-display)] text-[0.875rem] font-semibold tracking-[-0.01em] text-[var(--foreground-hi)]">
                {navLabels[card.key] ?? card.href}
              </h3>
              <div className="[font-family:var(--font-body)] text-[0.775rem] leading-[1.55] text-muted-foreground">
                {QUICK_LINK_DESCS[card.href]}
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Quick install */}
      <div>
        <p className="mb-3 [font-family:var(--font-display)] text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {quickInstall}
        </p>
        <pre className="overflow-x-auto rounded-[0.375rem] border border-[var(--border-strong)] border-t-[var(--primary)] bg-[#020207] px-[1.375rem] py-[1.125rem] [font-family:var(--font-code)] text-[0.825rem] leading-[1.65] text-[#d4d4d8]">
          <code>
            <span className="text-[#52525b]">
              # Build an agent in your app: core + one provider + tools
            </span>
            {'\n'}
            <span className="text-primary opacity-85">pnpm</span>
            {
              ' add @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic @robota-sdk/agent-tools'
            }
            {'\n\n'}
            <span className="text-[#52525b]">
              # Or try the reference CLI built from the same libraries
            </span>
            {'\n'}
            <span className="text-primary opacity-85">pnpm</span>
            {' add -g @robota-sdk/agent-cli'}
          </code>
        </pre>
      </div>
    </div>
  );
}

export default async function DocsPage({ params }: { params: Promise<PageParams> }) {
  const { slug, locale } = await params;
  setRequestLocale(locale);
  const resolvedSlug = slug ?? [];

  const [tHome, tNav] = await Promise.all([getTranslations('home'), getTranslations('nav')]);

  const sidebar = buildSidebar(locale);

  if (resolvedSlug.length === 0) {
    return (
      <DocsLayout sidebar={sidebar} toc={[]}>
        <HomePage
          badge={tHome('badge')}
          title={tHome('title')}
          titleHighlight={tHome('titleHighlight')}
          description={tHome('description')}
          getStarted={tHome('getStarted')}
          readGuide={tHome('readGuide')}
          quickInstall={tHome('quickInstall')}
          navLabels={{
            gettingStarted: tNav('gettingStarted'),
            guide: tNav('guide'),
            examples: tNav('examples'),
            packages: tNav('packages'),
            changelog: tNav('changelog'),
            development: tNav('development'),
          }}
        />
      </DocsLayout>
    );
  }

  if (isPackagesIndex(resolvedSlug)) {
    return (
      <DocsLayout sidebar={sidebar} toc={[]}>
        <PackagesIndex locale={locale} entries={buildPackageIndex(PACKAGES_DIR)} />
      </DocsLayout>
    );
  }

  const page = await getPageContent(resolvedSlug, locale);
  if (!page) notFound();

  const toc = extractToc(page.source);

  return (
    <DocsLayout sidebar={sidebar} toc={toc}>
      <MDXRemote
        source={page.source}
        components={components}
        options={{
          mdxOptions: {
            format: 'md',
            remarkPlugins: [
              remarkMermaid,
              [remarkFixLinks, { sourcePath: page.filePath, locale, repoRoot: MONOREPO_ROOT }],
              remarkGfm,
            ],
            rehypePlugins: [
              rehypeSlug,
              [
                rehypeAutolinkHeadings,
                {
                  behavior: 'wrap',
                  properties: {
                    className: ['anchor'],
                    ariaLabel: 'Link to section',
                  },
                },
              ],
              [
                rehypePrettyCode,
                {
                  theme: 'github-dark',
                  keepBackground: true,
                },
              ],
            ],
          },
        }}
      />
    </DocsLayout>
  );
}
