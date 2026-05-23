import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

import { getAllSlugs, getPageContent, extractTitle } from '@/lib/content';
import { buildSidebar } from '@/lib/sidebar';
import { extractToc } from '@/lib/toc';
import { remarkMermaid } from '@/lib/remark-mermaid';
import { DocsLayout } from '@/components/DocsLayout';
import { CodeBlock } from '@/components/mdx/CodeBlock';
import { MermaidDiagram } from '@/components/mdx/MermaidDiagram';
import { Callout } from '@/components/mdx/Callout';
import { PackageManagerTabs } from '@/components/mdx/PackageManagerTabs';

// MDX component map
const components = {
  // Wrap <pre> with copy button
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <CodeBlock {...props}>{children}</CodeBlock>
  ),
  MermaidDiagram,
  Callout,
  PackageManagerTabs,
};

interface PageParams {
  slug?: string[];
}

export async function generateStaticParams(): Promise<PageParams[]> {
  const slugs = getAllSlugs();
  return slugs.map((slug) => ({ slug: slug.length === 0 ? undefined : slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolvedSlug = slug ?? [];
  const page = await getPageContent(resolvedSlug);
  if (!page) return { title: 'Not Found' };

  const title = extractTitle(page.source, page.frontmatter);
  const description =
    (page.frontmatter.description as string | undefined) ??
    page.source.replace(/^#.*$/m, '').trim().slice(0, 160).replace(/\s+/g, ' ');

  return {
    title,
    description,
  };
}

const QUICK_LINKS = [
  {
    title: 'Getting Started',
    href: '/getting-started',
    desc: 'CLI quick start — first agent in 5 lines',
    tag: '01',
  },
  {
    title: 'Guide',
    href: '/guide',
    desc: 'Architecture, SDK, CLI, plugins, and more',
    tag: '02',
  },
  {
    title: 'Examples',
    href: '/examples',
    desc: 'Real-world code examples for common use cases',
    tag: '03',
  },
  {
    title: 'Packages',
    href: '/packages',
    desc: 'API reference for every SDK package',
    tag: '04',
  },
  {
    title: 'Changelog',
    href: '/changelog',
    desc: 'Release notes and version history',
    tag: '05',
  },
  {
    title: 'Development',
    href: '/development',
    desc: 'Contributing guide and development setup',
    tag: '06',
  },
];

// Custom home page — rendered for the root slug ([])
function HomePage() {
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
        {/* Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: '0.2rem 0.625rem',
            background: 'var(--primary-dim)',
            border: '1px solid rgba(0,255,136,0.2)',
            borderRadius: '0.25rem',
            fontSize: '0.72rem',
            fontFamily: 'var(--font-code)',
            color: 'var(--primary)',
            marginBottom: '1.5rem',
            letterSpacing: '0.06em',
          }}
        >
          <span style={{ opacity: 0.6 }}>$</span> open-source · MIT licensed
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
          Robota SDK
          <br />
          <span
            style={{
              color: 'var(--primary)',
              textShadow: '0 0 32px rgba(0,255,136,0.25)',
            }}
          >
            Documentation
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
          Multi-provider AI agent SDK and CLI — TypeScript-native, self-hostable. Supports
          Anthropic, OpenAI, DeepSeek, Gemini, and local models.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <a
            href="/getting-started"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.55rem 1.25rem',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              borderRadius: '0.25rem',
              fontWeight: 600,
              fontSize: '0.85rem',
              fontFamily: 'var(--font-display)',
              textDecoration: 'none',
              letterSpacing: '0.02em',
              boxShadow: '0 0 24px rgba(0,255,136,0.2)',
              transition: 'box-shadow 0.2s',
            }}
          >
            Get Started →
          </a>
          <a
            href="/guide"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.55rem 1.25rem',
              background: 'transparent',
              color: 'var(--foreground)',
              border: '1px solid var(--border-strong)',
              borderRadius: '0.25rem',
              fontWeight: 500,
              fontSize: '0.85rem',
              fontFamily: 'var(--font-display)',
              textDecoration: 'none',
              letterSpacing: '0.02em',
              transition: 'border-color 0.15s',
            }}
          >
            Read the Guide
          </a>
        </div>
      </div>

      {/* Quick links grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
          gap: '0.75rem',
          marginBottom: '3rem',
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
                color: 'rgba(0,255,136,0.25)',
                letterSpacing: '0.04em',
                userSelect: 'none',
              }}
            >
              {card.tag}
            </span>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                fontSize: '0.875rem',
                color: 'var(--foreground-hi)',
                marginBottom: '0.375rem',
                letterSpacing: '-0.01em',
              }}
            >
              {card.title}
            </div>
            <div
              style={{
                fontSize: '0.775rem',
                fontFamily: 'var(--font-body)',
                color: 'var(--muted-foreground)',
                lineHeight: 1.55,
              }}
            >
              {card.desc}
            </div>
          </a>
        ))}
      </div>

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
          Quick Install
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
  const { slug } = await params;
  const resolvedSlug = slug ?? [];

  // Build sidebar (server-side, cached between pages in the same build)
  const sidebar = buildSidebar();

  // Home page — render custom landing
  if (resolvedSlug.length === 0) {
    return (
      <DocsLayout sidebar={sidebar} toc={[]}>
        <HomePage />
      </DocsLayout>
    );
  }

  // Regular doc page
  const page = await getPageContent(resolvedSlug);
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
            remarkPlugins: [remarkMermaid, remarkGfm],
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
