import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createAgentRuntime, createNodeWorkspaceTrustService, runEval } from '/opt/robota/packages/agent-framework/src/index.ts';
import { OpenAIProvider } from '/opt/robota/packages/agent-provider-openai/src/index.ts';

const require = createRequire('/opt/robota/packages/agent-provider-openai/package.json');
const OpenAI = require('openai');
const MODEL = 'deepseek/deepseek-v4.1-flash-1017';
const lines = createInterface({ input: process.stdin });
const pending = new Map();
let initialize;
const initial = new Promise((resolve) => { initialize = resolve; });
lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.kind === 'init') initialize(message);
  else if (message.kind === 'reply') {
    const resolve = pending.get(message.id);
    pending.delete(message.id);
    resolve?.(message);
  }
});
let sequence = 0;
const emit = (value) => process.stdout.write(`BENCH:${JSON.stringify(value)}\n`);
const init = await initial;
process.env.HOME = '/tmp/home';
process.env.PRODUCT_USER_STATE_DIR = '/tmp/state';
mkdirSync('/tmp/home', { recursive: true });
execFileSync('git', ['init', '--quiet', '/work']);
const trust = createNodeWorkspaceTrustService('/tmp/home/trust.json', {
  sessions: '.bench-state/sessions', 'session-logs': '.bench-state/logs',
  memory: '.bench-state/memory', checkpoints: '.bench-state/checkpoints',
});
// The embedding owner authorized this one disposable synthetic project, never the user's checkout.
const projectAccess = await trust.grant('/work');
const client = new OpenAI({
  apiKey: 'credential-free-host-relay', baseURL: 'https://ai-gateway.vercel.sh/v1', maxRetries: 0,
  fetch: async (url, options) => {
    const id = ++sequence;
    const promise = new Promise((resolve) => pending.set(id, resolve));
    emit({ kind: 'request', id, url: String(url), body: JSON.parse(String(options.body)) });
    const reply = await promise;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  },
});
const provider = new OpenAIProvider({ client, baseURL: 'https://ai-gateway.vercel.sh/v1', defaultModel: MODEL, apiSurface: 'chat-completions' });
const originalChat = provider.chat.bind(provider);
provider.chat = (messages, options) => {
  // This experiment measures completed headless turns; preserve the native non-streaming adapter.
  provider.onTextDelta = undefined;
  return originalChat(messages, { ...options, onTextDelta: undefined, maxTokens: 8192 });
};
provider.chatStream = async function* (messages, options) { yield await provider.chat(messages, options); };
const runtime = createAgentRuntime({ cwd: '/work', provider, projectAccess, userSettingsSources: [], backgroundTaskRunners: [], sessionStore: undefined });
const session = runtime.createSession({
  bare: true, model: MODEL, maxTurns: 8, sessionStore: undefined,
  permissionMode: 'acceptEdits', allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  deniedTools: ['Bash', 'Shell', 'WebFetch', 'WebSearch', 'BackgroundProcess', 'Task', 'Agent', 'AgentJob', 'AskUserQuestion'],
  systemPrompt: 'You are a coding agent working in /work. Use only Read, Write, Edit, Glob and Grep on this project. Inspect relevant files, complete the requested change, and briefly state what changed. Do not edit tests or unrelated files. Do not run shell commands or access network services. Test execution is performed independently after your answer.',
});
const started = performance.now();
const timer = setTimeout(() => session.abort(), 360_000);
try {
  const handle = await session.submit(init.prompt);
  const result = await handle.completed;
  const completion = await runEval({ cases: [{ input: init.prompt }], metrics: [{ name: 'completed', required: true, score: (r) => !r.interrupted }] }, async () => result);
  emit({ kind: 'result', completed: completion.passed, interrupted: Boolean(result.interrupted), response: result.response, tools: result.toolSummaries, usage: result.usage, elapsedMs: performance.now() - started });
} catch (error) {
  emit({ kind: 'result', completed: false, error: String(error?.message ?? error), elapsedMs: performance.now() - started });
} finally {
  clearTimeout(timer);
  await session.shutdown();
  lines.close();
}
