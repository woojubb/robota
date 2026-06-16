import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { KeyRound, Repeat, Package, Server, ShieldCheck, Zap } from 'lucide-react';

const FEATURE_ICONS = [KeyRound, Repeat, Package, Server, ShieldCheck, Zap];

const PROVIDERS = [
  { name: 'Anthropic', color: 'text-orange-400' },
  { name: 'OpenAI', color: 'text-green-400' },
  { name: 'DeepSeek', color: 'text-blue-400' },
  { name: 'Gemini', color: 'text-yellow-400' },
  { name: 'Ollama', color: 'text-purple-400' },
];

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  const features = t.raw('features') as Array<{ title: string; description: string }>;

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
            {t('hero.badge')}
          </div>

          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-[var(--foreground)] sm:text-5xl lg:text-6xl">
            {t('hero.title')}
            <br />
            <span className="text-[var(--primary)]">{t('hero.titleHighlight')}</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--muted-foreground)]">
            {t('hero.description')}{' '}
            {PROVIDERS.map((p, i) => (
              <span key={p.name}>
                <span className={p.color}>{p.name}</span>
                {i < PROVIDERS.length - 1 ? ', ' : ''}
              </span>
            ))}{' '}
            {t('hero.descriptionSuffix')}
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="https://docs.robota.io/getting-started/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
            >
              {t('hero.getStarted')}
            </a>
            <a
              href="https://github.com/woojubb/robota"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
            >
              {t('hero.github')} ↗
            </a>
            <Link
              href={`/${locale}/compare`}
              className="rounded-lg border border-[var(--border)] bg-transparent px-5 py-2.5 text-sm font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('hero.compareTo')}
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
            {t('featuresTitle')}
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => {
              const Icon = FEATURE_ICONS[i] ?? KeyRound;
              return (
                <div
                  key={f.title}
                  className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"
                >
                  <Icon className="h-6 w-6 text-[var(--primary)]" strokeWidth={1.75} />
                  <h3 className="mt-3 text-base font-semibold text-[var(--foreground)]">
                    {f.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">{f.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
            {t('cta.title')}
          </h2>
          <p className="mt-4 text-[var(--muted-foreground)]">{t('cta.description')}</p>
          <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-left font-mono text-sm">
            <p>
              <span className="text-[var(--muted-foreground)]">{t('cta.commentInstall')}</span>
            </p>
            <p className="mt-1">
              <span className="text-[var(--primary)]">$</span>{' '}
              <span className="text-[var(--foreground)]">npm install -g @robota-sdk/agent-cli</span>
            </p>
            <p className="mt-3">
              <span className="text-[var(--muted-foreground)]">{t('cta.commentApiKey')}</span>
            </p>
            <p className="mt-1">
              <span className="text-[var(--primary)]">$</span>{' '}
              <span className="text-[var(--foreground)]">export ANTHROPIC_API_KEY=sk-ant-...</span>
            </p>
            <p className="mt-3">
              <span className="text-[var(--muted-foreground)]">{t('cta.commentLaunch')}</span>
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
            {t('cta.readGuide')}
          </a>
        </div>
      </section>
    </>
  );
}
