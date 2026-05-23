import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Build with Robota — Showcase',
  description:
    'Projects and tools built using Robota SDK — from CLI assistants to embedded AI agents.',
};

const FEATURED = [
  {
    name: 'Robota CLI',
    description:
      'The reference implementation. A full AI coding assistant built entirely on top of @robota-sdk/agent-framework and the TUI transport.',
    source: 'https://github.com/woojubb/robota',
    packages: ['agent-cli', 'agent-framework', 'agent-transport', 'agent-command', 'agent-tools'],
    highlights: [
      'Multi-provider switching',
      'Session persistence',
      'Permission system',
      'Plugin lifecycle',
      'Streaming TUI',
    ],
  },
  {
    name: 'Visual Agent Builder Playground',
    description:
      'A drag-and-drop canvas for assembling agents and exporting working TypeScript code. Runs entirely in the browser with BYOK.',
    live: 'https://play.robota.io/playground',
    packages: ['agent-framework', 'agent-provider', 'agent-tools'],
    highlights: ['Browser-based SDK usage', 'SSE streaming', 'Multi-provider BYOK', 'Code export'],
  },
];

export default function ShowcasePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-12 text-center">
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] sm:text-4xl">
          Build with Robota
        </h1>
        <p className="mt-4 text-[var(--muted-foreground)] max-w-xl mx-auto">
          Real projects built with Robota SDK — from terminal coding assistants to embedded AI in
          custom applications.
        </p>
      </div>

      {/* Featured */}
      <section className="mb-14">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-5 uppercase tracking-wider text-xs text-[var(--muted-foreground)]">
          Featured Projects
        </h2>
        <div className="grid gap-5">
          {FEATURED.map((project) => (
            <div
              key={project.name}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-lg font-bold text-[var(--foreground)]">{project.name}</h3>
                <div className="flex gap-2">
                  {project.source && (
                    <a
                      href={project.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    >
                      Source ↗
                    </a>
                  )}
                  {project.live && (
                    <a
                      href={project.live}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-[var(--accent-dim)] border border-[var(--primary)]/30 px-3 py-1 text-xs text-[var(--primary)] hover:opacity-80 transition-opacity"
                    >
                      Live demo ↗
                    </a>
                  )}
                </div>
              </div>

              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{project.description}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {project.packages.map((pkg) => (
                  <span
                    key={pkg}
                    className="rounded-full border border-[var(--border)] bg-[var(--muted)] px-2.5 py-0.5 text-xs text-[var(--muted-foreground)]"
                  >
                    @robota-sdk/{pkg}
                  </span>
                ))}
              </div>

              <ul className="mt-4 grid grid-cols-2 gap-1 sm:grid-cols-3">
                {project.highlights.map((h) => (
                  <li
                    key={h}
                    className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"
                  >
                    <span className="text-green-400">✓</span> {h}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Community */}
      <section className="mb-14">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-5">
          Community Projects
        </h2>
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted-foreground)] text-sm">
          No community projects listed yet. Be the first to submit yours.
        </div>
      </section>

      {/* Submit */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-3">Submit Your Project</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          To add your project to this page, open a PR adding an entry to the Community Projects
          section of{' '}
          <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-xs">
            apps/docs/docs/.temp/showcase/README.md
          </code>
          .
        </p>
        <ul className="space-y-1.5 text-sm text-[var(--muted-foreground)] mb-5">
          <li className="flex gap-2">
            <span className="text-[var(--primary)]">•</span> Must use at least one{' '}
            <code className="text-xs bg-[var(--muted)] px-1 rounded">@robota-sdk/*</code> package
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--primary)]">•</span> Public source code or live demo
            required
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--primary)]">•</span> Must be working as of the PR date
          </li>
        </ul>
        <a
          href="https://github.com/woojubb/robota/pulls"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
        >
          Open a Pull Request ↗
        </a>
      </section>
    </div>
  );
}
