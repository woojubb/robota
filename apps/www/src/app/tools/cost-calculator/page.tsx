import type { Metadata } from 'next';
import Link from 'next/link';
import { CostCalculator } from '@/components/CostCalculator';

export const metadata: Metadata = {
  title: 'API Cost Calculator',
  description:
    'See how much you would pay using Robota with direct API access compared to a flat Claude Code subscription.',
};

const PRICE_TABLE = [
  { provider: 'Anthropic', model: 'Claude Sonnet 4.x', input: '$3.00', output: '$15.00' },
  { provider: 'Anthropic', model: 'Claude Haiku 4.x', input: '$0.80', output: '$4.00' },
  { provider: 'OpenAI', model: 'GPT-4o', input: '$2.50', output: '$10.00' },
  { provider: 'OpenAI', model: 'GPT-4o mini', input: '$0.15', output: '$0.60' },
  { provider: 'DeepSeek', model: 'DeepSeek Chat', input: '$0.14', output: '$0.28' },
  { provider: 'Google', model: 'Gemini 2.0 Flash', input: '$0.10', output: '$0.40' },
];

export default function CostCalculatorPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] sm:text-4xl">
          API Cost Calculator
        </h1>
        <p className="mt-3 text-[var(--muted-foreground)]">
          Adjust the sliders to match your coding habits and see how Robota BYOK compares to a flat
          $20/month subscription.
        </p>
      </div>

      <CostCalculator />

      {/* How it works */}
      <section className="mt-14">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">How the estimate works</h2>
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Factor
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  What it controls
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Daily coding hours', 'Total time the AI assistant is active'],
                [
                  'Task type',
                  'Input/output token ratio (code review is input-heavy; generation is output-heavy)',
                ],
                ['Context usage', 'Overall prompt frequency multiplier'],
              ].map(([factor, desc], i) => (
                <tr
                  key={factor}
                  className={`border-b border-[var(--border)] ${i % 2 === 0 ? 'bg-[var(--background)]' : 'bg-[var(--card)]/50'}`}
                >
                  <td className="px-4 py-3 font-medium text-[var(--foreground)]">{factor}</td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          A typical working month is assumed to be{' '}
          <strong className="text-[var(--foreground)]">22 days</strong> at{' '}
          <strong className="text-[var(--foreground)]">50,000 tokens/hour</strong>.
        </p>
      </section>

      {/* Price reference */}
      <section className="mt-12">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">
          Token price reference{' '}
          <span className="text-sm font-normal text-[var(--muted-foreground)]">(May 2026)</span>
        </h2>
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Provider
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Model
                </th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--muted-foreground)]">
                  Input / 1M
                </th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--muted-foreground)]">
                  Output / 1M
                </th>
              </tr>
            </thead>
            <tbody>
              {PRICE_TABLE.map((row, i) => (
                <tr
                  key={row.model}
                  className={`border-b border-[var(--border)] ${i % 2 === 0 ? 'bg-[var(--background)]' : 'bg-[var(--card)]/50'}`}
                >
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{row.provider}</td>
                  <td className="px-4 py-3 text-[var(--foreground)]">{row.model}</td>
                  <td className="px-4 py-3 text-right text-[var(--foreground)]">{row.input}</td>
                  <td className="px-4 py-3 text-right text-[var(--foreground)]">{row.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          Prices are updated manually. Check the provider&apos;s official pricing page before making
          budget decisions.
        </p>
      </section>

      {/* Why Robota saves */}
      <section className="mt-12 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-3">
          Why Robota lets you save
        </h2>
        <ul className="space-y-2 text-sm text-[var(--muted-foreground)]">
          <li>
            <strong className="text-[var(--foreground)]">Light users</strong> (1–2 h/day) often pay{' '}
            <strong className="text-green-400">less than $2/month</strong> with efficient models.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">Heavy users</strong> can save by choosing
            DeepSeek or Gemini Flash for routine tasks and reserving Sonnet for complex reasoning.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">Free with local models</strong> — connect
            LM Studio or Ollama and pay zero. No API key required.
          </li>
        </ul>
      </section>

      <div className="mt-10 text-center">
        <Link href="/compare" className="text-sm text-[var(--primary)] hover:underline">
          ← Full feature comparison
        </Link>
      </div>
    </div>
  );
}
