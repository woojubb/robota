import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Enterprise',
  description:
    'Robota for engineering teams — security practices, self-hosted deployment, and enterprise support.',
};

const DATA_HANDLING = [
  ['Prompts and responses', 'Sent only to the AI provider you configure'],
  ['API keys', 'Stored in your local environment variables or secrets manager'],
  ['Session history', 'Written to your local filesystem (~/.robota/sessions/)'],
  ['Tool outputs (files, shell)', 'Stay on your machine'],
];

const FAQ = [
  {
    q: 'Does Robota store my code in the cloud?',
    a: 'No. All file reads and writes happen on your local machine. The only data that leaves your machine is the prompt you send to your configured AI provider.',
  },
  {
    q: 'Can we use Robota behind a corporate proxy?',
    a: "Yes. Set the standard HTTPS_PROXY environment variable and the SDK's HTTP client will route through it.",
  },
  {
    q: 'Can Robota be installed in a restricted network with no internet access?',
    a: 'Yes — use a local LLM (Ollama, LM Studio) and install npm packages from an internal registry mirror.',
  },
  {
    q: 'Is there a commercial license option?',
    a: 'Robota is MIT-licensed and free to use commercially without restriction. Enterprise support contracts (SLA, dedicated channels, custom integrations) are available — contact us for details.',
  },
];

export default function EnterprisePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
      <div className="mb-12">
        <h1 className="text-3xl font-extrabold text-[var(--foreground)] sm:text-4xl">Enterprise</h1>
        <p className="mt-4 text-[var(--muted-foreground)]">
          Robota is used by engineering teams that need a controllable, self-hostable AI coding
          assistant. This page covers security practices, deployment options, and how to get in
          touch.
        </p>
      </div>

      {/* Contact */}
      <section className="mb-12 rounded-xl border border-[var(--primary)]/30 bg-[var(--accent-dim)] p-6">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-2">Contact Us</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          To discuss team licensing, on-premises deployment, priority support, or custom
          integrations, open a GitHub Discussion or email us directly.
        </p>
        <p className="text-sm text-[var(--muted-foreground)] mb-5">
          We respond to all enterprise inquiries within{' '}
          <strong className="text-[var(--foreground)]">30 business days</strong>.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/woojubb/robota/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
          >
            GitHub Discussions (enterprise tag) ↗
          </a>
          <a
            href="mailto:enterprise@robota.io"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            enterprise@robota.io
          </a>
        </div>
      </section>

      {/* Security policy */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">Security Policy</h2>

        <h3 className="text-base font-semibold text-[var(--foreground)] mb-3">Data Handling</h3>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Robota operates as a local CLI or self-hosted server.{' '}
          <strong className="text-[var(--foreground)]">
            No conversation data is stored or transmitted to Robota servers
          </strong>{' '}
          — the SDK calls the AI provider of your choice directly from your machine or
          infrastructure.
        </p>
        <div className="rounded-xl border border-[var(--border)] overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card)]">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Data type
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)]">
                  Where it goes
                </th>
              </tr>
            </thead>
            <tbody>
              {DATA_HANDLING.map(([type, dest], i) => (
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
          On-Premises Deployment
        </h3>
        <p className="text-sm text-[var(--muted-foreground)] mb-3">
          Robota supports fully air-gapped deployments using local LLMs:
        </p>
        <ul className="space-y-2 text-sm text-[var(--muted-foreground)] mb-4">
          <li className="flex gap-2">
            <span className="text-[var(--primary)]">•</span>{' '}
            <strong className="text-[var(--foreground)]">Ollama</strong> — run models locally with
            zero external network calls
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--primary)]">•</span>{' '}
            <strong className="text-[var(--foreground)]">LM Studio</strong> — OpenAI-compatible
            local server
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--primary)]">•</span>{' '}
            <strong className="text-[var(--foreground)]">Any OpenAI-compatible endpoint</strong> —
            point baseURL to your internal gateway
          </li>
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
          {[
            {
              title: 'MIT License',
              body: 'Full source code available for audit at github.com/woojubb/robota',
            },
            { title: 'No telemetry', body: 'No analytics, no phone-home in the SDK or CLI' },
            {
              title: 'Append-only session logs',
              body: 'You control retention and deletion of all local session files',
            },
            {
              title: 'SOC 2 / ISO 27001 compatible',
              body: 'When combined with a compliant AI provider',
            },
          ].map((item) => (
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
        <h2 className="text-xl font-bold text-[var(--foreground)] mb-5">FAQ</h2>
        <div className="space-y-4">
          {FAQ.map((item) => (
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
          Vulnerability Disclosure
        </h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          To report a security vulnerability, email{' '}
          <a href="mailto:security@robota.io" className="text-[var(--primary)] hover:underline">
            security@robota.io
          </a>{' '}
          with a description and reproduction steps. We follow responsible disclosure and aim to
          issue a patch within <strong className="text-[var(--foreground)]">14 days</strong> of
          confirmation.
        </p>
      </section>
    </div>
  );
}
