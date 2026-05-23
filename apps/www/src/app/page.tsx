import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Robota — Open-Source AI Agent SDK',
};

const PROVIDERS = [
  { name: 'Anthropic', color: 'text-orange-400' },
  { name: 'OpenAI', color: 'text-green-400' },
  { name: 'DeepSeek', color: 'text-blue-400' },
  { name: 'Gemini', color: 'text-yellow-400' },
  { name: 'Ollama', color: 'text-purple-400' },
];

const FEATURES = [
  {
    icon: '🔑',
    title: 'BYOK — No Subscription',
    description:
      'Bring your own API key. Pay only for tokens you use. No $20/month plans, no seat limits imposed by Robota.',
  },
  {
    icon: '🔄',
    title: 'Any Provider, One Config',
    description:
      'Switch between Anthropic, OpenAI, DeepSeek, Gemini, or a local Ollama model by changing one line in your config.',
  },
  {
    icon: '📦',
    title: 'Embeddable SDK',
    description:
      'Import @robota-sdk/agent-framework into your app and ship the same agent runtime your users already know.',
  },
  {
    icon: '🏠',
    title: 'Fully Self-Hostable',
    description:
      'Run entirely on-premises with local LLMs. No data leaves your machine except to the AI provider you choose.',
  },
  {
    icon: '🔓',
    title: 'MIT Licensed',
    description:
      'Every line is publicly auditable and free to fork, modify, and use in commercial products — no CLA required.',
  },
  {
    icon: '⚡',
    title: 'TypeScript-First',
    description:
      'Strict types end-to-end. No any, no implicit casts, no runtime surprises. Designed for real TypeScript codebases.',
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden py-20 sm:py-28">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(167,139,250,0.18),transparent)]"
        />
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--muted-foreground)]">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            Public Beta · v3.0.0-beta
          </div>

          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-[var(--foreground)] sm:text-5xl lg:text-6xl">
            The open-source AI agent SDK
            <br />
            <span className="text-[var(--primary)]">that you actually own</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--muted-foreground)]">
            Multi-provider BYOK CLI and embeddable SDK. Switch between{' '}
            {PROVIDERS.map((p, i) => (
              <span key={p.name}>
                <span className={p.color}>{p.name}</span>
                {i < PROVIDERS.length - 1 ? ', ' : ''}
              </span>
            ))}{' '}
            with one config change. MIT licensed.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="https://docs.robota.io/getting-started/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
            >
              Get Started
            </a>
            <a
              href="https://github.com/woojubb/robota"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              GitHub ↗
            </a>
            <Link
              href="/compare"
              className="rounded-lg border border-[var(--border)] bg-transparent px-5 py-2.5 text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              Compare Tools
            </Link>
          </div>

          {/* Install snippet */}
          <div className="mt-10 inline-block rounded-lg border border-[var(--border)] bg-[var(--card)] px-5 py-3 font-mono text-sm text-[var(--muted-foreground)]">
            <span className="text-[var(--primary)]">$</span>{' '}
            <span className="text-[var(--foreground)]">npx @robota-sdk/agent-cli</span>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
            Everything you need. Nothing you don&apos;t.
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"
              >
                <div className="text-2xl">{f.icon}</div>
                <h3 className="mt-3 text-base font-semibold text-[var(--foreground)]">{f.title}</h3>
                <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cost teaser — 요금 페이지 미준비, 준비 후 주석 해제
      <section className="py-16 sm:py-20 bg-[var(--card)]">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
            Light users pay <span className="text-[var(--primary)]">less than $2/month</span>
          </h2>
          <p className="mt-4 text-[var(--muted-foreground)]">
            Claude Code charges a flat $20/month. With Robota you pay only for tokens you actually
            use — or nothing at all if you run a local model.
          </p>
          <Link
            href="/tools/cost-calculator"
            className="mt-6 inline-block rounded-lg border border-[var(--border)] bg-[var(--muted)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]/80 transition-colors"
          >
            Calculate your cost →
          </Link>
        </div>
      </section>
      */}

      {/* CTA */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
            Start in 30 seconds
          </h2>
          <p className="mt-4 text-[var(--muted-foreground)]">
            No account. No subscription. Just a terminal and an API key.
          </p>
          <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-left font-mono text-sm">
            <p>
              <span className="text-[var(--muted-foreground)]"># Install globally</span>
            </p>
            <p className="mt-1">
              <span className="text-[var(--primary)]">$</span>{' '}
              <span className="text-[var(--foreground)]">npm install -g @robota-sdk/agent-cli</span>
            </p>
            <p className="mt-3">
              <span className="text-[var(--muted-foreground)]"># Set your API key</span>
            </p>
            <p className="mt-1">
              <span className="text-[var(--primary)]">$</span>{' '}
              <span className="text-[var(--foreground)]">export ANTHROPIC_API_KEY=sk-ant-...</span>
            </p>
            <p className="mt-3">
              <span className="text-[var(--muted-foreground)]"># Launch</span>
            </p>
            <p className="mt-1">
              <span className="text-[var(--primary)]">$</span>{' '}
              <span className="text-[var(--foreground)]">robota</span>
            </p>
          </div>
          <a
            href="https://docs.robota.io/getting-started/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-block rounded-lg bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
          >
            Read the full Getting Started guide →
          </a>
        </div>
      </section>
    </>
  );
}
