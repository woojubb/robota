import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function BetaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('beta');

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--muted-foreground)]">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
          {t('badge')}
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-[var(--foreground)] sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mx-auto mt-4 max-w-prose text-base text-[var(--muted-foreground)]">
          {t('description')}
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 text-center sm:p-8">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">{t('comingSoonTitle')}</h2>
        <p className="mx-auto mt-2 max-w-prose text-sm text-[var(--muted-foreground)]">
          {t('comingSoonBody')}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href="https://docs.robota.io/getting-started/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
          >
            {t('ctaDocs')}
          </a>
          <a
            href="https://github.com/woojubb/robota/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            {t('ctaGithub')}
          </a>
        </div>
      </div>
    </div>
  );
}
