import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { getMarketingMetadata } from '@/lib/marketing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return getMarketingMetadata(locale === 'ko' ? 'ko' : 'en', 'compare');
}

export default async function ComparePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('compare');
  const differentiatorItems = t.raw('differentiators.items') as Array<{
    title: string;
    body: string;
  }>;
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-4 text-lg text-[var(--muted-foreground)] max-w-2xl mx-auto">
          {t('description')}
        </p>
      </div>

      {/* Key differentiators */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-6">
          {t('differentiators.title')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {differentiatorItems.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"
            >
              <h3 className="font-semibold text-[var(--foreground)]">{item.title}</h3>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{item.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <a href="__PROJECT_DOCS_URL__/en/guide/providers/" target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">
            {t('proofLinks.providers')}
          </a>
          <a href="__PROJECT_DOCS_URL__/en/guide/local-llm/" target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">
            {t('proofLinks.local')}
          </a>
          <a href="__PROJECT_REPOSITORY_URL__/blob/main/LICENSING.md" target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">
            {t('proofLinks.license')}
          </a>
        </div>
      </section>

      <div className="text-center">
        <a
          href={`__PROJECT_DOCS_URL__/${locale}/getting-started/`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-[var(--primary-foreground)] hover:bg-[var(--accent-hover)] transition-colors"
        >
          {t('tryButton')}
        </a>
      </div>
    </div>
  );
}
