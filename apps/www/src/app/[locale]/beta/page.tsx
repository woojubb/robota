'use client';

import { useState } from 'react';

interface FormData {
  name: string;
  email: string;
  currentTool: string;
  useCase: string;
}

const INITIAL_FORM: FormData = {
  name: '',
  email: '',
  currentTool: '',
  useCase: '',
};

export default function BetaPage() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/beta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        throw new Error(`Submission failed: ${response.statusText}`);
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <div className="mb-4 text-4xl">🎉</div>
        <h2 className="mb-2 text-2xl font-bold text-[var(--foreground)]">Application received!</h2>
        <p className="text-[var(--muted-foreground)]">
          We&apos;ll review your application and get back to you within 48 hours with your
          onboarding guide.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--muted-foreground)]">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
          Limited spots available
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-[var(--foreground)] sm:text-4xl">
          Join the Robota Beta
        </h1>
        <p className="mx-auto mt-4 max-w-prose text-base text-[var(--muted-foreground)]">
          Be among the first developers to shape Robota. Beta members get direct access to the team,
          early features, and their feedback directly drives the roadmap.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8"
      >
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="name"
            className="mb-1.5 block text-sm font-medium text-[var(--foreground)]"
          >
            Name <span className="text-red-400">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            value={form.name}
            onChange={handleChange}
            placeholder="Your name"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-[var(--foreground)]"
          >
            Email <span className="text-red-400">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={form.email}
            onChange={handleChange}
            placeholder="you@example.com"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </div>

        <div>
          <label
            htmlFor="currentTool"
            className="mb-1.5 block text-sm font-medium text-[var(--foreground)]"
          >
            Current AI coding tool
          </label>
          <select
            id="currentTool"
            name="currentTool"
            value={form.currentTool}
            onChange={handleChange}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            <option value="">Select one…</option>
            <option value="claude-code">Claude Code</option>
            <option value="cursor">Cursor</option>
            <option value="aider">Aider</option>
            <option value="cline">Cline</option>
            <option value="copilot">GitHub Copilot</option>
            <option value="none">None — starting fresh</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="useCase"
            className="mb-1.5 block text-sm font-medium text-[var(--foreground)]"
          >
            How do you plan to use Robota? <span className="text-red-400">*</span>
          </label>
          <textarea
            id="useCase"
            name="useCase"
            required
            rows={4}
            value={form.useCase}
            onChange={handleChange}
            placeholder="e.g. Embed the SDK in my SaaS product, use the CLI for daily coding, build a multi-provider chatbot…"
            className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Apply for Beta Access'}
        </button>

        <p className="text-center text-xs text-[var(--muted-foreground)]">
          We review applications within 48 hours and reply with an onboarding guide.
        </p>
      </form>
    </div>
  );
}
