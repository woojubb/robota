import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Why Robota — Compare AI Coding Tools',
  description:
    'How Robota compares to Claude Code, Cursor, Aider, and Cline — features, cost, and freedom.',
};

const FEATURE_ROWS = [
  {
    feature: 'Multi-provider (one config)',
    robota: true,
    claudeCode: false,
    cursor: false,
    aider: true,
    cline: true,
  },
  {
    feature: 'BYOK — no subscription required',
    robota: true,
    claudeCode: true,
    cursor: false,
    aider: true,
    cline: true,
    cursorNote: 'subscription',
  },
  {
    feature: 'Local model support (Ollama/LM Studio)',
    robota: true,
    claudeCode: false,
    cursor: false,
    aider: true,
    cline: true,
  },
  {
    feature: 'Embeddable SDK',
    robota: true,
    claudeCode: false,
    cursor: false,
    aider: false,
    cline: false,
  },
  {
    feature: 'Open source (MIT)',
    robota: true,
    claudeCode: false,
    cursor: false,
    aider: true,
    cline: true,
    claudeCodeNote: 'proprietary',
    cursorNote: 'proprietary',
    aiderNote: 'Apache 2',
  },
  {
    feature: 'TypeScript-first, strict types',
    robota: true,
    claudeCode: true,
    cursor: true,
    aider: false,
    cline: true,
    aiderNote: 'Python',
  },
  {
    feature: 'Terminal CLI',
    robota: true,
    claudeCode: true,
    cursor: false,
    aider: true,
    cline: true,
    cursorNote: 'IDE only',
  },
  {
    feature: 'Session persistence & resume',
    robota: true,
    claudeCode: true,
    cursor: true,
    aider: false,
    cline: false,
  },
  {
    feature: 'Background agents',
    robota: true,
    claudeCode: true,
    cursor: false,
    aider: false,
    cline: false,
  },
  {
    feature: 'Self-hostable',
    robota: true,
    claudeCode: false,
    cursor: false,
    aider: true,
    cline: true,
  },
];

const COST_ROWS = [
  { tool: 'Robota', model: 'BYOK — pay your provider', estimate: '~$5–30 depending on model' },
  { tool: 'Claude Code', model: 'BYOK (Anthropic API)', estimate: '~$20–80 with Claude Sonnet' },
  { tool: 'Cursor', model: 'Subscription', estimate: '$20/mo (Pro) + API overages' },
  { tool: 'Aider', model: 'BYOK', estimate: '~$5–30 depending on model' },
  { tool: 'Cline', model: 'BYOK (VSCode extension)', estimate: '~$5–30 depending on model' },
];

function Check() {
  return <span className="text-green-400 font-bold">✓</span>;
}

function Cross({ note }: { note?: string }) {
  return (
    <span className="text-[var(--muted-foreground)]">
      {note ? <span className="text-xs">{note}</span> : '✗'}
    </span>
  );
}

export default function ComparePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] sm:text-4xl">
          Why Robota?
        </h1>
        <p className="mt-4 text-lg text-[var(--muted-foreground)] max-w-2xl mx-auto">
          The only AI coding CLI that lets you bring your own key for any provider, run offline with
          a local model, and embed the same engine into your own app — all under the MIT license.
        </p>
      </div>

      {/* Feature comparison table */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">Feature Comparison</h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Feature
                </th>
                <th className="px-4 py-3 text-center font-semibold text-[var(--primary)]">
                  Robota
                </th>
                <th className="px-4 py-3 text-center font-semibold text-[var(--muted-foreground)]">
                  Claude Code
                </th>
                <th className="px-4 py-3 text-center font-semibold text-[var(--muted-foreground)]">
                  Cursor
                </th>
                <th className="px-4 py-3 text-center font-semibold text-[var(--muted-foreground)]">
                  Aider
                </th>
                <th className="px-4 py-3 text-center font-semibold text-[var(--muted-foreground)]">
                  Cline
                </th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row, i) => (
                <tr
                  key={row.feature}
                  className={`border-b border-[var(--border)] ${i % 2 === 0 ? 'bg-[var(--background)]' : 'bg-[var(--card)]/50'}`}
                >
                  <td className="px-4 py-3 text-[var(--foreground)]">{row.feature}</td>
                  <td className="px-4 py-3 text-center">{row.robota ? <Check /> : <Cross />}</td>
                  <td className="px-4 py-3 text-center">
                    {row.claudeCode ? <Check /> : <Cross note={row.claudeCodeNote} />}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.cursor ? <Check /> : <Cross note={row.cursorNote} />}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.aider ? <Check /> : <Cross note={row.aiderNote} />}
                  </td>
                  <td className="px-4 py-3 text-center">{row.cline ? <Check /> : <Cross />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cost comparison */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">Cost Comparison</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Estimated monthly cost at 4 h/day active usage.
        </p>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Tool
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Pricing model
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Monthly estimate
                </th>
              </tr>
            </thead>
            <tbody>
              {COST_ROWS.map((row, i) => (
                <tr
                  key={row.tool}
                  className={`border-b border-[var(--border)] ${i % 2 === 0 ? 'bg-[var(--background)]' : 'bg-[var(--card)]/50'}`}
                >
                  <td
                    className={`px-4 py-3 font-medium ${row.tool === 'Robota' ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'}`}
                  >
                    {row.tool}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{row.model}</td>
                  <td className="px-4 py-3 text-[var(--foreground)]">{row.estimate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">
          <strong className="text-[var(--foreground)]">Robota + Gemini Flash</strong> —
          Google&apos;s free tier covers casual use at zero cost.{' '}
          <strong className="text-[var(--foreground)]">Robota + local Ollama</strong> — pay nothing,
          fully offline.
        </p>
      </section>

      {/* Key differentiators */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-6">
          What Makes Robota Different
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              title: '1. Any Provider — One Config',
              body: 'Switch between Anthropic, OpenAI, DeepSeek, Gemini, or Ollama by changing one line in ~/.robota/settings.json. No code changes, no new subscriptions.',
            },
            {
              title: '2. Embeddable SDK',
              body: 'Ship the same agent runtime to your users via @robota-sdk/agent-framework. No other AI coding assistant exposes this — Claude Code, Cursor, and Cline are closed products.',
            },
            {
              title: '3. Fully Open Source (MIT)',
              body: 'Every line is publicly auditable. Fork it, modify it, self-host it, build commercial products — no CLA required.',
            },
            {
              title: '4. Local Model First-Class',
              body: 'Point any Ollama or LM Studio model as your provider. Your code and prompts never leave your machine.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"
            >
              <h3 className="font-semibold text-[var(--foreground)]">{item.title}</h3>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* When to choose something else */}
      <section className="mb-14 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">
          When to Choose Something Else
        </h2>
        <ul className="space-y-3 text-sm text-[var(--muted-foreground)]">
          <li>
            <strong className="text-[var(--foreground)]">Choose Claude Code</strong> if you want the
            tightest Claude integration and are happy with Anthropic-only.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">Choose Cursor</strong> if you want an
            IDE-first experience with inline diff editing and tab completion.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">Choose Aider</strong> if you prefer a
            Python ecosystem and work primarily with git-based batch commits.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">Choose Cline</strong> if you want a VSCode
            sidebar agent and don&apos;t need embedding or SDK usage.
          </li>
        </ul>
      </section>

      <div className="text-center">
        <a
          href="https://docs.robota.io/getting-started/"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
        >
          Try Robota now →
        </a>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          Or{' '}
          <Link href="/tools/cost-calculator" className="text-[var(--primary)] hover:underline">
            calculate your exact cost
          </Link>
        </p>
      </div>
    </div>
  );
}
