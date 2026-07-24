import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getAllSlugs, getPageContent, extractTitle } from '@/lib/content';
import { buildSidebar } from '@/lib/sidebar';
import { extractToc } from '@/lib/toc';
import { remarkMermaid } from '@/lib/remark-mermaid';
import { remarkFixLinks } from '@/lib/remark-fix-links';
import { DocsLayout } from '@/components/DocsLayout';
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
  const page = await getPageContent(resolvedSlug, locale);
  if (!page) return { title: 'Not Found' };

  const title = extractTitle(page.source, page.frontmatter);
  const description =
    (page.frontmatter.description as string | undefined) ??
    page.source.replace(/^#.*$/m, '').trim().slice(0, 160).replace(/\s+/g, ' ');

  return { title, description };
}

const QUICK_LINK_DESCS: Record<string, string> = {
  'getting-started': 'CLI quick start — first agent in 5 lines',
  guide: 'Architecture, SDK, CLI, plugins, and more',
  examples: 'Real-world code examples for common use cases',
  packages: 'API reference for every SDK package',
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
      <div
        style={{
          marginBottom: '3rem',
          paddingBottom: '2.5rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: '0.2rem 0.625rem',
            background: 'var(--primary-dim)',
            border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
            borderRadius: '0.25rem',
            fontSize: '0.72rem',
            fontFamily: 'var(--font-code)',
            color: 'var(--primary)',
            marginBottom: '1.5rem',
            letterSpacing: '0.06em',
          }}
        >
          <span style={{ opacity: 0.6 }}>$</span> {badge}
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2.25rem',
            fontWeight: 700,
            lineHeight: 1.12,
            marginBottom: '1.125rem',
            color: 'var(--foreground-hi)',
            letterSpacing: '-0.025em',
          }}
        >
          {title}
          <br />
          <span
            style={{
              color: 'var(--primary)',
              textShadow: '0 0 32px color-mix(in srgb, var(--accent) 25%, transparent)',
            }}
          >
            {titleHighlight}
          </span>
        </h1>

        <p
          style={{
            fontSize: '1rem',
            fontFamily: 'var(--font-body)',
            color: 'var(--muted-foreground)',
            lineHeight: 1.75,
            maxWidth: '52ch',
            marginBottom: '1.75rem',
          }}
        >
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
      <section aria-labelledby="docs-sections-heading" style={{ marginBottom: '3rem' }}>
        <h2
          id="docs-sections-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.7rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--muted-foreground)',
            margin: '0 0 0.875rem',
          }}
        >
          Explore the docs
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {QUICK_LINKS.map((card) => (
            <a
              key={card.href}
              href={card.href}
              style={{
                display: 'block',
                padding: '1.125rem',
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '0.375rem',
                textDecoration: 'none',
                transition: 'border-color 0.2s, background 0.2s',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: '0.75rem',
                  right: '0.875rem',
                  fontFamily: 'var(--font-code)',
                  fontSize: '0.65rem',
                  color: 'color-mix(in srgb, var(--accent) 25%, transparent)',
                  letterSpacing: '0.04em',
                  userSelect: 'none',
                }}
              >
                {card.tag}
              </span>
              <h3
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  color: 'var(--foreground-hi)',
                  margin: '0 0 0.375rem',
                  letterSpacing: '-0.01em',
                }}
              >
                {navLabels[card.key] ?? card.href}
              </h3>
              <div
                style={{
                  fontSize: '0.775rem',
                  fontFamily: 'var(--font-body)',
                  color: 'var(--muted-foreground)',
                  lineHeight: 1.55,
                }}
              >
                {QUICK_LINK_DESCS[card.href]}
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Quick install */}
      <div>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.7rem',
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--muted-foreground)',
            marginBottom: '0.75rem',
          }}
        >
          {quickInstall}
        </p>
        <pre
          style={{
            background: '#020207',
            border: '1px solid var(--border-strong)',
            borderTop: '1px solid var(--primary)',
            borderRadius: '0.375rem',
            padding: '1.125rem 1.375rem',
            fontSize: '0.825rem',
            fontFamily: 'var(--font-code)',
            color: '#d4d4d8',
            overflowX: 'auto',
            lineHeight: 1.65,
          }}
        >
          <code>
            <span style={{ color: '#52525b' }}># Install the CLI globally</span>
            {'\n'}
            <span style={{ color: 'var(--primary)', opacity: 0.85 }}>pnpm</span>
            {' add -g @robota-sdk/agent-cli'}
            {'\n\n'}
            <span style={{ color: '#52525b' }}># Or install SDK packages for your app</span>
            {'\n'}
            <span style={{ color: 'var(--primary)', opacity: 0.85 }}>pnpm</span>
            {' add @robota-sdk/agent-core @robota-sdk/agent-provider'}
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
            remarkPlugins: [remarkMermaid, remarkFixLinks, remarkGfm],
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
