import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Showcase' };

export default async function ShowcasePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('showcase');

  const projects = t.raw('projects') as Array<{
    name: string;
    description: string;
    highlights: string[];
  }>;
  const submitRequirements = t.raw('submitRequirements') as string[];

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-12">
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-4 text-[var(--muted-foreground)]">{t('description')}</p>
      </div>

      {/* Featured Projects */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-6">{t('featuredTitle')}</h2>
        <div className="space-y-5">
          {projects.map((project) => (
            <div
              key={project.name}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6"
            >
              <h3 className="text-lg font-semibold text-[var(--foreground)]">{project.name}</h3>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{project.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {project.highlights.map((h) => (
                  <span
                    key={h}
                    className="rounded-full bg-[var(--accent-dim)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent)]"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* WEB-018: the Community Projects section is hidden until there are real entries — an
          empty "no projects yet" placeholder undercuts launch credibility, and the Submit
          section below already invites contributions. Restore (with real entries) when content
          exists; the `communityTitle`/`communityEmpty` strings are kept in the dictionaries.
      <section className="mb-14">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">{t('communityTitle')}</h2>
        <p className="text-sm text-[var(--muted-foreground)] italic">{t('communityEmpty')}</p>
      </section>
      */}

      {/* Submit */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-2">{t('submitTitle')}</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-3">
          {t('submitDescription')}{' '}
          <a
            href="https://github.com/woojubb/robota"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] hover:underline"
          >
            GitHub
          </a>
          .
        </p>
        <ul className="mb-5 space-y-1.5">
          {submitRequirements.map((req) => (
            <li key={req} className="flex gap-2 text-sm text-[var(--muted-foreground)]">
              <span className="text-[var(--primary)] shrink-0">•</span>
              {req}
            </li>
          ))}
        </ul>
        <a
          href="https://github.com/woojubb/robota/pulls"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:bg-[var(--accent-hover)] transition-colors"
        >
          {t('submitButton')}
        </a>
      </section>
    </div>
  );
}
