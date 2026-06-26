import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function RoadmapPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('roadmap');

  const nowItems = t.raw('now.items') as Array<{
    feature: string;
    status: string;
    release: string;
  }>;
  const nextItems = t.raw('next.items') as string[];
  const laterItems = t.raw('later.items') as string[];

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-3 text-[var(--muted-foreground)]">
          {t('description')}{' '}
          <strong className="text-[var(--foreground)]">{t('descriptionHighlight')}</strong>
          {t('descriptionSuffix')}
        </p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {t('lastUpdated')}{' '}
          <a
            href="https://github.com/woojubb/robota/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] hover:underline"
          >
            {t('githubIssues')}
          </a>
        </p>
      </div>

      {/* Now */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-1">{t('now.title')}</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">{t('now.subtitle')}</p>
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  {(t.raw('now.tableHeaders') as string[])[0]}
                </th>
                <th className="px-4 py-3 text-center font-semibold text-[var(--muted-foreground)]">
                  {(t.raw('now.tableHeaders') as string[])[1]}
                </th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--muted-foreground)]">
                  {(t.raw('now.tableHeaders') as string[])[2]}
                </th>
              </tr>
            </thead>
            <tbody>
              {nowItems.map((item, i) => (
                <tr
                  key={item.feature}
                  className={`border-b border-[var(--border)] ${i % 2 === 0 ? 'bg-[var(--background)]' : 'bg-[var(--card)]/50'}`}
                >
                  <td className="px-4 py-3 text-[var(--foreground)]">{item.feature}</td>
                  <td className="px-4 py-3 text-center">
                    {item.status === 'done' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-400/10 px-2 py-0.5 text-xs font-medium text-green-400">
                        ✓ {t('now.statusDone')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--primary)]">
                        📋 {t('now.statusPlanned')}
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
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-1">{t('next.title')}</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">{t('next.subtitle')}</p>
        <ul className="space-y-3">
          {nextItems.map((item) => (
            <li key={item} className="flex gap-3 text-sm">
              <span className="mt-0.5 text-[var(--primary)] shrink-0">→</span>
              <span className="text-[var(--muted-foreground)]">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Later */}
      <section className="mb-12">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-1">{t('later.title')}</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">{t('later.subtitle')}</p>
        <ul className="space-y-2">
          {laterItems.map((item) => (
            <li key={item} className="flex gap-3 text-sm">
              <span className="mt-0.5 text-[var(--muted-foreground)] shrink-0">·</span>
              <span className="text-[var(--muted-foreground)]">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Vote */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-2">{t('vote.title')}</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">{t('vote.description')}</p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/woojubb/robota/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:bg-[var(--accent-hover)] transition-colors"
          >
            {t('vote.githubDiscussions')}
          </a>
          <a
            href="https://github.com/woojubb/robota/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]/80 transition-colors"
          >
            {t('vote.openIssues')}
          </a>
        </div>
      </section>
    </div>
  );
}
