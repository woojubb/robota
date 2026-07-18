/**
 * Capability: evals-as-code — define metrics over your agent's runs and gate CI on a metric breach.
 *
 * A metric is a pure function over the run's `IExecutionResult` (response + tool trajectory + usage +
 * history) — NOT just the response string. `runEval` runs each case through a `runFn`, scores it, and reports
 * a pass/fail against a threshold; a failing eval `process.exit(1)`s so it fails a CI job.
 *
 * The `runFn` here is built from `createAgentRuntime().createSession()` via `createSessionRunFn` — a real
 * agent run per case. Run: ANTHROPIC_API_KEY=... pnpm dev
 *
 * (The metrics + dataset below are CONSUMER content — the SDK ships only the neutral definition/runner.)
 */
import {
  createAgentRuntime,
  createSessionRunFn,
  defineEval,
  runEval,
  type IMetric,
} from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY.');
  process.exit(1);
}

// A custom metric: the run's final response must mention the file the case asked about.
const mentionsRequestedFile: IMetric = {
  name: 'mentions-requested-file',
  score: (result) => result.response.includes('package.json'),
};

// A second metric over the run TRAJECTORY (not the string): the agent actually read a file.
const usedAFileTool: IMetric = {
  name: 'used-a-file-tool',
  score: (result) => result.toolSummaries.some((t) => t.name === 'Read' || t.name === 'Grep'),
};

const definition = defineEval({
  name: 'file-awareness',
  cases: [
    { input: 'Which file declares this project’s npm scripts? Name it.' },
    { input: 'Name the file that lists this project’s dependencies.' },
  ],
  metrics: [mentionsRequestedFile, usedAFileTool],
  threshold: 0.75, // ≥ 75% of the case×metric checks must pass
});

const provider = new AnthropicProvider({ apiKey });
const runtime = createAgentRuntime({ cwd: process.cwd(), provider });
const runFn = createSessionRunFn(runtime);

const report = await runEval(definition, runFn);

console.log(`\nEval: ${report.name ?? '(unnamed)'}`);
for (const [i, caseResult] of report.results.entries()) {
  const scores = caseResult.scores.map((s) => `${s.metric}=${String(s.score)}`).join(', ');
  console.log(`  case ${i + 1} [${caseResult.caseScore.toFixed(2)}] ${scores}`);
}
console.log(
  `Overall ${report.overallScore.toFixed(2)} vs threshold ${report.threshold.toFixed(2)} → ${
    report.passed ? 'PASS' : 'FAIL'
  }`,
);

// CI-gate behavior: a metric breach fails the job.
process.exit(report.passed ? 0 : 1);
