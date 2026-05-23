import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    "What's coming next in Robota SDK — current priorities, next quarter, and future exploration.",
};

const NOW = [
  { feature: 'Context warning banner (70% / 90%)', status: 'done', release: 'beta.67' },
  { feature: '/compact result summary', status: 'done', release: 'beta.67' },
  { feature: '3-level permission memory (session / project)', status: 'done', release: 'beta.67' },
  { feature: 'robota init project setup command', status: 'done', release: 'beta.67' },
  { feature: 'Plugin development guide + directory', status: 'done', release: 'beta.67' },
  { feature: 'Changelog page', status: 'done', release: 'beta.67' },
  { feature: '? key keyboard shortcut overlay', status: 'done', release: 'beta.67' },
  { feature: '--dry-run flag (plan-only preview)', status: 'done', release: 'beta.67' },
  { feature: 'Session auto-naming from first message', status: 'planned', release: 'beta.68' },
  {
    feature: '/cost improvements — per-session cost tracking',
    status: 'planned',
    release: 'beta.68',
  },
];

const NEXT = [
  'v1.0.0 release candidate — declared when all P0 bugs are resolved and core user journeys verified end-to-end',
  'GitHub Actions official action (robota-sdk/action@v1) — run Robota as a CI bot in any workflow',
  'Official plugins starter pack — 5 community plugin templates: logging, Slack alerts, cost tracking, Linear integration, Datadog metrics',
  'SDK embedding examples — Next.js, Express, and CLI script reference implementations',
  'Robota Cloud beta — hosted sessions, team sharing, usage dashboard (BYOK free tier)',
];

const LATER = [
  'Session share links (share a conversation URL)',
  'Multi-agent visual canvas in the terminal',
  'Native VS Code extension (beyond the current CLI)',
  'Enterprise SSO and audit logs',
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] sm:text-4xl">Roadmap</h1>
        <p className="mt-3 text-[var(--muted-foreground)]">
          Robota SDK is currently in{' '}
          <strong className="text-[var(--foreground)]">public beta (v3.0.0-beta)</strong>. This page
          is updated quarterly.
        </p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Last updated: 2026-05-23 ·{' '}
          <a
            href="https://github.com/woojubb/robota/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] hover:underline"
          >
            GitHub Issues ↗
          </a>
        </p>
      </div>

      {/* Now */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-1">Now — Beta Polish</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Q2 2026 · Active development window
        </p>
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Feature
                </th>
                <th className="px-4 py-3 text-center font-semibold text-[var(--muted-foreground)]">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--muted-foreground)]">
                  Release
                </th>
              </tr>
            </thead>
            <tbody>
              {NOW.map((item, i) => (
                <tr
                  key={item.feature}
                  className={`border-b border-[var(--border)] ${i % 2 === 0 ? 'bg-[var(--background)]' : 'bg-[var(--card)]/50'}`}
                >
                  <td className="px-4 py-3 text-[var(--foreground)]">{item.feature}</td>
                  <td className="px-4 py-3 text-center">
                    {item.status === 'done' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-400/10 px-2 py-0.5 text-xs font-medium text-green-400">
                        ✓ Done
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--primary)]">
                        📋 Planned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-[var(--muted-foreground)]">
                    {item.release}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Next */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-1">Next — Q3 2026</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">Planned for the next quarter</p>
        <ul className="space-y-3">
          {NEXT.map((item) => (
            <li key={item} className="flex gap-3 text-sm">
              <span className="mt-0.5 text-[var(--primary)] shrink-0">→</span>
              <span className="text-[var(--muted-foreground)]">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Later */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-1">Later — Exploration</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Ideas under consideration. No commitment on timing.
        </p>
        <ul className="space-y-2">
          {LATER.map((item) => (
            <li key={item} className="flex gap-3 text-sm">
              <span className="mt-0.5 text-[var(--muted-foreground)] shrink-0">·</span>
              <span className="text-[var(--muted-foreground)]">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Vote */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-2">Vote and Suggest</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          The most-upvoted issues influence priority in next-quarter planning.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/woojubb/robota/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
          >
            GitHub Discussions ↗
          </a>
          <a
            href="https://github.com/woojubb/robota/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]/80 transition-colors"
          >
            Open Issues ↗
          </a>
        </div>
      </section>
    </div>
  );
}
