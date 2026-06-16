import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function EnterprisePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('enterprise');

  const dataHandlingRows = t.raw('security.dataHandling.rows') as string[][];
  const onPremisesItems = t.raw('security.onPremises.items') as Array<{
    name: string;
    body: string;
  }>;
  const securityHighlights = t.raw('security.highlights') as Array<{
    title: string;
    body: string;
  }>;
  const faqItems = t.raw('faq.items') as Array<{ q: string; a: string }>;

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-12">
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-4 text-[var(--muted-foreground)]">{t('description')}</p>
      </div>

      {/* Contact */}
      <section className="mb-12 rounded-xl border border-[var(--primary)]/30 bg-[var(--accent-dim)] p-6">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-2">{t('contact.title')}</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">{t('contact.description')}</p>
        <p className="text-sm text-[var(--muted-foreground)] mb-5">
          {t('contact.responseTime')}{' '}
          <strong className="text-[var(--foreground)]">{t('contact.responseTimeHighlight')}</strong>
          {t('contact.responseTimeSuffix')}
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/woojubb/robota/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
          >
            {t('contact.githubDiscussions')}
          </a>
          <a
            href="mailto:enterprise@robota.io"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            {t('contact.email')}
          </a>
        </div>
      </section>

      {/* Security policy */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">{t('security.title')}</h2>

        <h3 className="text-base font-semibold text-[var(--foreground)] mb-3">
          {t('security.dataHandling.title')}
        </h3>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          {t('security.dataHandling.description')}{' '}
          <strong className="text-[var(--foreground)]">
            {t('security.dataHandling.highlight')}
          </strong>{' '}
          {t('security.dataHandling.descriptionSuffix')}
        </p>
        <div className="rounded-xl border border-[var(--border)] overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  {(t.raw('security.dataHandling.tableHeaders') as string[])[0]}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  {(t.raw('security.dataHandling.tableHeaders') as string[])[1]}
                </th>
              </tr>
            </thead>
            <tbody>
              {dataHandlingRows.map(([type, dest], i) => (
                <tr
                  key={type}
                  className={`border-b border-[var(--border)] ${i % 2 === 0 ? 'bg-[var(--background)]' : 'bg-[var(--card)]/50'}`}
                >
                  <td className="px-4 py-3 font-medium text-[var(--foreground)]">{type}</td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{dest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-base font-semibold text-[var(--foreground)] mb-3">
          {t('security.onPremises.title')}
        </h3>
        <p className="text-sm text-[var(--muted-foreground)] mb-3">
          {t('security.onPremises.description')}
        </p>
        <ul className="space-y-2 text-sm text-[var(--muted-foreground)] mb-4">
          {onPremisesItems.map((item) => (
            <li key={item.name} className="flex gap-2">
              <span className="text-[var(--primary)]">•</span>{' '}
              <strong className="text-[var(--foreground)]">{item.name}</strong> — {item.body}
            </li>
          ))}
        </ul>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 font-mono text-sm text-[var(--muted-foreground)]">
          <p>
            <span className="text-purple-400">import</span> {'{ OpenAIProvider }'}{' '}
            <span className="text-purple-400">from</span>{' '}
            <span className="text-green-400">&apos;@robota-sdk/openai&apos;</span>;
          </p>
          <p className="mt-2">
            <span className="text-purple-400">const</span> provider ={' '}
            <span className="text-purple-400">new</span>{' '}
            <span className="text-blue-400">OpenAIProvider</span>
            {'({'}
          </p>
          <p className="ml-4">
            apiKey: <span className="text-green-400">&apos;local&apos;</span>,
          </p>
          <p className="ml-4">
            baseURL:{' '}
            <span className="text-green-400">&apos;http://your-internal-gateway/v1&apos;</span>,
          </p>
          <p className="ml-4">
            model: <span className="text-green-400">&apos;your-model-name&apos;</span>,
          </p>
          <p>{'}'});</p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {securityHighlights.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <p className="font-semibold text-[var(--foreground)] text-sm">{item.title}</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-5">{t('faq.title')}</h2>
        <div className="space-y-4">
          {faqItems.map((item) => (
            <div
              key={item.q}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"
            >
              <p className="font-semibold text-[var(--foreground)] text-sm">{item.q}</p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Vulnerability disclosure */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-2">
          {t('vulnerabilityDisclosure.title')}
        </h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t('vulnerabilityDisclosure.description')}{' '}
          <a href="mailto:security@robota.io" className="text-[var(--primary)] hover:underline">
            security@robota.io
          </a>{' '}
          {t('vulnerabilityDisclosure.descriptionSuffix')}{' '}
          <strong className="text-[var(--foreground)]">
            {t('vulnerabilityDisclosure.patchDays')}
          </strong>{' '}
          {t('vulnerabilityDisclosure.patchDaysSuffix')}
        </p>
      </section>
    </div>
  );
}
