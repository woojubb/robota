'use client';

import { useState, useMemo } from 'react';

const MODELS = [
  { id: 'claude-sonnet', label: 'Claude Sonnet 4.x', inputPer1M: 3.0, outputPer1M: 15.0 },
  { id: 'claude-haiku', label: 'Claude Haiku 4.x', inputPer1M: 0.8, outputPer1M: 4.0 },
  { id: 'gpt4o', label: 'GPT-4o', inputPer1M: 2.5, outputPer1M: 10.0 },
  { id: 'gpt4o-mini', label: 'GPT-4o mini', inputPer1M: 0.15, outputPer1M: 0.6 },
  { id: 'deepseek', label: 'DeepSeek Chat', inputPer1M: 0.14, outputPer1M: 0.28 },
  { id: 'gemini-flash', label: 'Gemini 2.0 Flash', inputPer1M: 0.1, outputPer1M: 0.4 },
];

const TASK_TYPES = [
  { id: 'mixed', label: 'Mixed (typical)', inputRatio: 0.5 },
  { id: 'codegen', label: 'Code generation', inputRatio: 0.3 },
  { id: 'review', label: 'Code review', inputRatio: 0.7 },
  { id: 'chat', label: 'Q&A / Chat', inputRatio: 0.6 },
];

const EXPERIENCE_LEVELS = [
  { id: 'light', label: 'Light (short prompts)', multiplier: 0.6 },
  { id: 'moderate', label: 'Moderate', multiplier: 1.0 },
  { id: 'heavy', label: 'Heavy (long context)', multiplier: 1.8 },
];

const WORKING_DAYS = 22;
const TOKENS_PER_HOUR = 50_000;
const CLAUDE_CODE_MONTHLY = 20;

function fmt(n: number) {
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

export function CostCalculator() {
  const [hours, setHours] = useState(2);
  const [modelId, setModelId] = useState('claude-sonnet');
  const [taskTypeId, setTaskTypeId] = useState('mixed');
  const [levelId, setLevelId] = useState('moderate');

  const result = useMemo(() => {
    const model = MODELS.find((m) => m.id === modelId)!;
    const task = TASK_TYPES.find((t) => t.id === taskTypeId)!;
    const level = EXPERIENCE_LEVELS.find((l) => l.id === levelId)!;

    const dailyTokens = hours * TOKENS_PER_HOUR * level.multiplier;
    const monthlyTokens = dailyTokens * WORKING_DAYS;
    const inputTokens = monthlyTokens * task.inputRatio;
    const outputTokens = monthlyTokens * (1 - task.inputRatio);

    const cost =
      (inputTokens / 1_000_000) * model.inputPer1M + (outputTokens / 1_000_000) * model.outputPer1M;

    const saving = CLAUDE_CODE_MONTHLY - cost;

    return { cost, saving, monthlyTokens: Math.round(monthlyTokens / 1000) };
  }, [hours, modelId, taskTypeId, levelId]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      {/* Inputs */}
      <div className="p-6 grid gap-6 sm:grid-cols-2">
        {/* Daily hours slider */}
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
            Daily coding hours: <span className="text-[var(--primary)]">{hours}h</span>
          </label>
          <input
            type="range"
            min={0.5}
            max={8}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(parseFloat(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
          <div className="flex justify-between text-xs text-[var(--muted-foreground)] mt-1">
            <span>0.5h</span>
            <span>8h</span>
          </div>
        </div>

        {/* Model */}
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
            AI Model
          </label>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Task type */}
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
            Task type
          </label>
          <div className="grid grid-cols-2 gap-2">
            {TASK_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTaskTypeId(t.id)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  taskTypeId === t.id
                    ? 'border-[var(--primary)] bg-[var(--accent-dim)] text-[var(--primary)]'
                    : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Experience level */}
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
            Context usage
          </label>
          <div className="grid grid-cols-3 gap-2">
            {EXPERIENCE_LEVELS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLevelId(l.id)}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  levelId === l.id
                    ? 'border-[var(--primary)] bg-[var(--accent-dim)] text-[var(--primary)]'
                    : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Result */}
      <div className="border-t border-[var(--border)] bg-[var(--muted)] p-6 grid sm:grid-cols-3 gap-6 text-center">
        <div>
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Est. monthly tokens
          </p>
          <p className="text-2xl font-bold text-[var(--foreground)]">
            {result.monthlyTokens.toLocaleString()}K
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            Robota BYOK cost
          </p>
          <p className="text-2xl font-bold text-[var(--primary)]">{fmt(result.cost)}</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">per month</p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider mb-1">
            vs Claude Code $20/mo
          </p>
          {result.saving >= 0 ? (
            <p className="text-2xl font-bold text-green-400">Save {fmt(result.saving)}</p>
          ) : (
            <p className="text-2xl font-bold text-orange-400">+{fmt(-result.saving)}</p>
          )}
        </div>
      </div>

      <p className="px-6 py-3 text-xs text-[var(--muted-foreground)] border-t border-[var(--border)]">
        Estimate based on {TOKENS_PER_HOUR.toLocaleString()} tokens/hour and {WORKING_DAYS} working
        days/month. Prices as of May 2026 — verify with provider before making budget decisions.
      </p>
    </div>
  );
}
