import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Compare' };

const FEATURE_ROW_DATA = [
  { robota: true, claudeCode: false, cursor: false, aider: true, cline: true },
  {
    robota: true,
    claudeCode: true,
    cursor: false,
    aider: true,
    cline: true,
    cursorNote: 'subscription',
  },
  { robota: true, claudeCode: false, cursor: false, aider: true, cline: true },
  { robota: true, claudeCode: false, cursor: false, aider: false, cline: false },
  {
    robota: true,
    claudeCode: false,
    cursor: false,
    aider: true,
    cline: true,
    claudeCodeNote: 'proprietary',
    cursorNote: 'proprietary',
    aiderNote: 'Apache 2',
  },
  { robota: true, claudeCode: true, cursor: true, aider: false, cline: true, aiderNote: 'Python' },
  {
    robota: true,
    claudeCode: true,
    cursor: false,
    aider: true,
    cline: true,
    cursorNote: 'IDE only',
  },
  { robota: true, claudeCode: true, cursor: true, aider: false, cline: false },
  { robota: true, claudeCode: true, cursor: false, aider: false, cline: false },
  { robota: true, claudeCode: false, cursor: false, aider: true, cline: true },
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

export default async function ComparePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('compare');
  const features = t.raw('features') as string[];
  const notes = t.raw('notes') as Record<string, string>;
  const noteLabel = (note?: string) => (note ? (notes[note] ?? note) : undefined);
  const differentiatorItems = t.raw('differentiators.items') as Array<{
    title: string;
    body: string;
  }>;
  const whenElseItems = t.raw('whenElse.items') as Array<{ label: string; body: string }>;

  const featureRows = features.map((feature, i) => ({
    feature,
    ...FEATURE_ROW_DATA[i],
  }));

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

      {/* Feature comparison table */}
      <section className="mb-14">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">
          {t('featureComparison')}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  {t('featureColumnHeader')}
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
              {featureRows.map((row, i) => (
                <tr
                  key={row.feature}
                  className={`border-b border-[var(--border)] ${i % 2 === 0 ? 'bg-[var(--background)]' : 'bg-[var(--card)]/50'}`}
                >
                  <td className="px-4 py-3 text-[var(--foreground)]">{row.feature}</td>
                  <td className="px-4 py-3 text-center">{row.robota ? <Check /> : <Cross />}</td>
                  <td className="px-4 py-3 text-center">
                    {row.claudeCode ? <Check /> : <Cross note={noteLabel(row.claudeCodeNote)} />}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.cursor ? <Check /> : <Cross note={noteLabel(row.cursorNote)} />}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.aider ? <Check /> : <Cross note={noteLabel(row.aiderNote)} />}
                  </td>
                  <td className="px-4 py-3 text-center">{row.cline ? <Check /> : <Cross />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
      </section>

      {/* When to choose something else */}
      <section className="mb-14 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">{t('whenElse.title')}</h2>
        <ul className="space-y-3 text-sm text-[var(--muted-foreground)]">
          {whenElseItems.map((item) => (
            <li key={item.label}>
              <strong className="text-[var(--foreground)]">{item.label}</strong> {item.body}
            </li>
          ))}
        </ul>
      </section>

      <div className="text-center">
        <a
          href="https://docs.robota.io/getting-started/"
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
