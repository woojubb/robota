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

// Custom home page — rendered for the root slug ([])
function HomePage() {
  return (
    <div>
      <div
        style={{
          marginBottom: '3rem',
          paddingBottom: '2rem',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.75rem',
            background: 'var(--accent-dim)',
            border: '1px solid rgba(167,139,250,0.25)',
            borderRadius: '9999px',
            fontSize: '0.8rem',
            color: 'var(--primary)',
            marginBottom: '1.25rem',
            fontWeight: 500,
          }}
        >
          Open Source · MIT Licensed
        </div>
        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            lineHeight: 1.15,
            marginBottom: '1rem',
            color: 'var(--foreground)',
          }}
        >
          Robota SDK
          <br />
          <span style={{ color: 'var(--primary)' }}>Documentation</span>
        </h1>
        <p
          style={{
            fontSize: '1.125rem',
            color: 'var(--muted-foreground)',
            lineHeight: 1.7,
            maxWidth: '56ch',
            marginBottom: '1.5rem',
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
              padding: '0.6rem 1.25rem',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              borderRadius: '0.5rem',
              fontWeight: 600,
              fontSize: '0.9rem',
              textDecoration: 'none',
              transition: 'opacity 0.15s',
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
              padding: '0.6rem 1.25rem',
              background: 'var(--muted)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              fontWeight: 500,
              fontSize: '0.9rem',
              textDecoration: 'none',
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
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '3rem',
        }}
      >
        {[
          {
            title: 'Getting Started',
            href: '/getting-started',
            desc: 'CLI quick start and first agent in 5 lines',
            icon: '🚀',
          },
          {
            title: 'Guide',
            href: '/guide',
            desc: 'Architecture, SDK, CLI, plugins, and more',
            icon: '📖',
          },
          {
            title: 'Examples',
            href: '/examples',
            desc: 'Real-world code examples for common use cases',
            icon: '💡',
          },
          {
            title: 'Packages',
            href: '/packages',
            desc: 'API reference for every SDK package',
            icon: '📦',
          },
          {
            title: 'Changelog',
            href: '/changelog',
            desc: 'Release notes and version history',
            icon: '📋',
          },
          {
            title: 'Development',
            href: '/development',
            desc: 'Contributing guide and development setup',
            icon: '🛠',
          },
        ].map((card) => (
          <a
            key={card.href}
            href={card.href}
            style={{
              display: 'block',
              padding: '1.25rem',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '0.625rem',
              textDecoration: 'none',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{card.icon}</div>
            <div
              style={{
                fontWeight: 600,
                fontSize: '0.95rem',
                color: 'var(--foreground)',
                marginBottom: '0.35rem',
              }}
            >
              {card.title}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
              {card.desc}
            </div>
          </a>
        ))}
      </div>

      {/* Quick install */}
      <div>
        <h2
          style={{
            fontSize: '1.2rem',
            fontWeight: 600,
            marginBottom: '0.75rem',
            color: 'var(--foreground)',
          }}
        >
          Quick Install
        </h2>
        <pre
          style={{
            background: '#0d1117',
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            padding: '1rem 1.25rem',
            fontSize: '0.875rem',
            fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
            color: '#e8e6f0',
            overflowX: 'auto',
          }}
        >
          <code>
            <span style={{ color: '#7b7a95' }}># Install the CLI globally</span>
            {'\n'}
            <span style={{ color: '#a78bfa' }}>pnpm</span> add -g @robota-sdk/agent-cli
            {'\n\n'}
            <span style={{ color: '#7b7a95' }}># Or install SDK packages for your app</span>
            {'\n'}
            <span style={{ color: '#a78bfa' }}>pnpm</span> add @robota-sdk/agent-core
            @robota-sdk/agent-provider
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
            remarkPlugins: [remarkGfm],
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
