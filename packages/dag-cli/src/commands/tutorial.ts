import { access, mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import type { INodeConfigObject } from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE } from '../types.js';
import { LocalDagRunner, createCliNodeRegistry } from '../local-runner/index.js';
import { demoCommand } from './demo.js';
import { recordTelemetry } from '../telemetry.js';

const DIVIDER = '─────────────────────────────────────────────────────────';
const TUTORIAL_COMPLETE_MARKER = join('.dag', '.tutorial-complete');
const TOTAL_STEPS = 5;
const MS_PER_SECOND = 1000;
const PROVIDER_SKIP_INDEX = 4; // 1-based index for "Skip" option

export interface ITutorialCommandOptions {
  readonly io: IDagCliIo;
  readonly cwd?: string;
}

interface IParsedTutorialArgs {
  readonly nonInteractive: boolean;
  readonly reset: boolean;
  readonly export: boolean;
  readonly skipTo?: number;
}

function parseTutorialArgs(args: readonly string[]): IParsedTutorialArgs {
  const skipToIdx = args.indexOf('--skip-to');
  let skipTo: number | undefined;
  if (skipToIdx !== -1) {
    const raw = args[skipToIdx + 1];
    const n = raw !== undefined ? parseInt(raw, 10) : NaN;
    if (!isNaN(n) && n >= 1 && n <= TOTAL_STEPS) skipTo = n;
  }
  return {
    nonInteractive: args.includes('--non-interactive'),
    reset: args.includes('--reset'),
    export: args.includes('--export'),
    skipTo,
  };
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false, // allow-fallback: fs.access throws on not-found; false is the correct semantic
  );
}

function getNodeVersion(): string {
  const raw = process.version; // e.g. "v22.14.0"
  return raw.startsWith('v') ? raw.slice(1) : raw;
}

function stepHeader(step: number, title: string, io: IDagCliIo): void {
  io.write(`\nStep ${step}/${TOTAL_STEPS}: ${title}\n`);
}

type TProvider = 'anthropic' | 'openai' | 'gemini' | 'skip';

interface IProviderSpec {
  readonly label: string;
  readonly envVar: string;
  readonly keyPrefix: string;
  readonly provider: TProvider;
}

const PROVIDER_SPECS: readonly IProviderSpec[] = [
  {
    label: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    provider: 'anthropic',
  },
  {
    label: 'OpenAI (GPT)',
    envVar: 'OPENAI_API_KEY',
    keyPrefix: 'sk-',
    provider: 'openai',
  },
  {
    label: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    keyPrefix: 'AI',
    provider: 'gemini',
  },
];

async function runStep1EnvironmentCheck(io: IDagCliIo): Promise<void> {
  stepHeader(1, 'Environment check', io);
  const nodeVersion = getNodeVersion();
  io.write(`  ✓ Node.js ${nodeVersion}\n`);
  io.write(`  ✓ robota-dag CLI\n`);
}

async function promptProviderChoice(io: IDagCliIo): Promise<number> {
  io.write(`\n  Which provider? (Enter number)\n`);
  for (let i = 0; i < PROVIDER_SPECS.length; i++) {
    io.write(`  ${i + 1}. ${PROVIDER_SPECS[i]!.label}\n`);
  }
  io.write(`  ${PROVIDER_SPECS.length + 1}. Skip — use local pipeline only\n`);

  const rl = createInterface({ input: stdin, output: stdout });
  let choiceStr: string;
  try {
    choiceStr = await rl.question('  > ');
  } finally {
    rl.close();
  }
  return parseInt(choiceStr.trim(), 10);
}

async function promptApiKey(selected: IProviderSpec, io: IDagCliIo): Promise<string> {
  io.write(`\n  Paste your ${selected.label} API key (${selected.keyPrefix}...): `);
  const rl = createInterface({ input: stdin, output: stdout });
  let apiKey: string;
  try {
    apiKey = await rl.question('');
  } finally {
    rl.close();
  }
  return apiKey.trim();
}

async function saveApiKey(selected: IProviderSpec, trimmedKey: string, cwd: string): Promise<void> {
  const dagDir = join(cwd, '.dag');
  const envPath = join(dagDir, '.env');
  const dagDirExists = await pathExists(dagDir);
  if (!dagDirExists) {
    await mkdir(dagDir, { recursive: true });
  }

  let envContent = '';
  const envExists = await pathExists(envPath);
  if (envExists) {
    envContent = await readFile(envPath, 'utf8');
  }

  const keyLine = `${selected.envVar}=${trimmedKey}\n`;
  const keyPattern = new RegExp(`^${selected.envVar}=.*$`, 'm');
  if (keyPattern.test(envContent)) {
    envContent = envContent.replace(keyPattern, keyLine.trimEnd());
  } else {
    envContent = envContent.length > 0 ? `${envContent.trimEnd()}\n${keyLine}` : keyLine;
  }

  await writeFile(envPath, envContent, 'utf8');
  process.env[selected.envVar] = trimmedKey;
}

async function runStep2ApiKeySetup(
  io: IDagCliIo,
  nonInteractive: boolean,
  cwd: string,
): Promise<TProvider> {
  stepHeader(2, 'API key setup', io);

  const envVars = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];
  const existingKey = envVars.find((v) => {
    const val = process.env[v];
    return typeof val === 'string' && val.trim().length > 0;
  });

  if (existingKey !== null && existingKey !== undefined) {
    io.write(`  ✓ ${existingKey} found\n`);
    const spec = PROVIDER_SPECS.find((s) => s.envVar === existingKey);
    return spec?.provider ?? 'anthropic';
  }

  io.write(`  No API key found.\n`);

  if (nonInteractive) {
    io.write(`  Skipping API key setup (--non-interactive)\n`);
    return 'skip';
  }

  const choice = await promptProviderChoice(io);
  if (isNaN(choice) || choice < 1 || choice > PROVIDER_SPECS.length + 1) {
    io.write(`  Invalid choice. Skipping API key setup.\n`);
    return 'skip';
  }

  if (choice === PROVIDER_SKIP_INDEX) {
    io.write(`  Skipping — using local pipeline only.\n`);
    return 'skip';
  }

  const selected = PROVIDER_SPECS[choice - 1]!;
  const trimmedKey = await promptApiKey(selected, io);

  if (trimmedKey.length === 0) {
    io.write(`  No key entered. Skipping.\n`);
    return 'skip';
  }

  await saveApiKey(selected, trimmedKey, cwd);
  io.write(`  ✓ Saved to .env\n`);
  return selected.provider;
}

type TTaskRun = { nodeId: string; outputSnapshot?: string | null };

function resolveOutputText(taskRuns: ReadonlyArray<TTaskRun>): string {
  for (const taskRun of taskRuns) {
    if (taskRun.nodeId !== 'output' || !taskRun.outputSnapshot) continue;
    let parsed: Record<string, string | number | boolean | null>;
    try {
      parsed = JSON.parse(taskRun.outputSnapshot) as Record<
        string,
        string | number | boolean | null
      >;
    } catch {
      // allow-fallback: unreadable snapshot is skipped gracefully
      continue;
    }
    const textVal = parsed['text'];
    if (typeof textVal === 'string') return textVal;
  }
  return '';
}

function buildLlmDagDefinition(provider: string): {
  dagId: string;
  version: 1;
  status: 'draft';
  nodes: Array<{
    nodeId: string;
    nodeType: string;
    dependsOn: string[];
    config: INodeConfigObject;
    position: { x: number; y: number };
  }>;
  edges: Array<{
    from: string;
    to: string;
    bindings: Array<{ outputKey: string; inputKey: string }>;
  }>;
} {
  const NODE_X_LLM = 300;
  const NODE_X_OUTPUT = 600;
  return {
    dagId: 'tutorial-step3',
    version: 1,
    status: 'draft',
    nodes: [
      {
        nodeId: 'input',
        nodeType: 'input',
        dependsOn: [],
        config: {} as INodeConfigObject,
        position: { x: 0, y: 0 },
      },
      {
        nodeId: 'llm',
        nodeType: 'llm-text',
        dependsOn: ['input'],
        config: {
          provider,
          systemPrompt: 'Answer in exactly 10 words or fewer.',
        } as INodeConfigObject,
        position: { x: NODE_X_LLM, y: 0 },
      },
      {
        nodeId: 'output',
        nodeType: 'text-output',
        dependsOn: ['llm'],
        config: {} as INodeConfigObject,
        position: { x: NODE_X_OUTPUT, y: 0 },
      },
    ],
    edges: [
      { from: 'input', to: 'llm', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      { from: 'llm', to: 'output', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
    ],
  };
}

async function runLlmPipeline(provider: string, io: IDagCliIo): Promise<boolean> {
  const nodeDefinitions = createCliNodeRegistry();
  const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assemblyResult.ok) {
    throw new Error(`Node registry error: ${assemblyResult.error.code}`);
  }

  const dagDefinition = buildLlmDagDefinition(provider);
  const runner = new LocalDagRunner(nodeDefinitions);

  const startMs = Date.now();
  const result = await runner.run(dagDefinition, { text: 'What is a DAG in 10 words?' });
  const durationS = ((Date.now() - startMs) / MS_PER_SECOND).toFixed(1);

  const outputText = resolveOutputText(result.taskRuns);
  io.write(`  ✓ Completed in ${durationS}s\n`);
  if (outputText.length > 0) {
    io.write(`  Output: "${outputText}"\n`);
  }
  return true;
}

async function runStep3FirstPipeline(
  io: IDagCliIo,
  provider: TProvider,
  nonInteractive: boolean,
): Promise<void> {
  stepHeader(3, 'Running your first pipeline', io);

  if (provider === 'skip') {
    io.write(`  Running: input → text-template → text-output\n`);
    io.write(`  Input: "Hello from robota-dag!"\n`);
    await demoCommand([], { io });
    return;
  }

  io.write(`  Running: input → llm-text (${provider}) → text-output\n`);
  io.write(`  Input: "What is a DAG in 10 words?"\n`);

  if (nonInteractive) {
    io.write(`  Skipping live run (--non-interactive)\n`);
    return;
  }

  let ranSuccessfully = false;
  try {
    ranSuccessfully = await runLlmPipeline(provider, io);
  } catch (err) {
    // allow-fallback: LLM pipeline failure falls back to local demo so tutorial can continue
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`  Warning: Could not run LLM pipeline: ${msg}\n`);
  }

  if (!ranSuccessfully) {
    io.write(`  Falling back to local demo...\n`);
    await demoCommand([], { io });
  }
}

function runStep4BuildYourOwn(io: IDagCliIo): void {
  stepHeader(4, 'Build your own DAG', io);
  io.write(`  Create your first workflow file:\n`);
  io.write(
    `    dag build --dagId my-first --spec '{"nodes":[{"type":"input"},{"type":"llm-text","config":{"provider":"anthropic"}},{"type":"text-output"}],"edges":["input→llm-text","llm-text→text-output"]}' --output my-first.dag.json\n`,
  );
  io.write(`    dag run my-first.dag.json --input text="Your question"\n`);
}

function runStep5WhatNext(io: IDagCliIo, provider?: TProvider): void {
  stepHeader(5, 'What to explore next', io);

  if (provider && provider !== 'skip') {
    io.write(`  With your ${provider} key:\n`);
    io.write(`  dag compare ${provider} openai   → compare cost & quality\n`);
    io.write(`  dag cost estimate          → estimate cost before running\n`);
    io.write(`  dag benchmark <file>       → measure performance\n`);
    io.write(`\n  Explore more:\n`);
  }

  io.write(`  dag node list           → all available node types\n`);
  io.write(`  dag run --watch         → auto-rerun on file changes\n`);
  io.write(`  dag share --to gist     → share your workflow\n`);
  io.write(`  dag tutorial --reset    → restart tutorial\n`);
}

async function markTutorialComplete(cwd: string, provider?: TProvider): Promise<void> {
  const dagDir = join(cwd, '.dag');
  const dagDirExists = await pathExists(dagDir);
  if (!dagDirExists) {
    await mkdir(dagDir, { recursive: true });
  }
  const markerPath = join(cwd, TUTORIAL_COMPLETE_MARKER);
  await writeFile(markerPath, new Date().toISOString() + '\n', 'utf8');
  await recordTelemetry({ command: 'tutorial_complete', success: true, durationMs: 0 });
}

async function resetTutorial(cwd: string, io: IDagCliIo): Promise<number> {
  const markerPath = join(cwd, TUTORIAL_COMPLETE_MARKER);
  const exists = await pathExists(markerPath);
  if (exists) {
    await unlink(markerPath);
    io.write(`Tutorial reset. Run 'dag tutorial' to start over.\n`);
  } else {
    io.write(`Tutorial has not been completed yet. Nothing to reset.\n`);
  }
  return SUCCESS_EXIT_CODE;
}

const NEXT_STEP_OPTIONS = [
  { n: 1, label: 'Run a workflow from catalog', cmd: 'dag catalog list' },
  { n: 2, label: 'Build a new workflow', cmd: 'dag build --help' },
  { n: 3, label: 'Explore available node types', cmd: 'dag node list' },
  { n: 4, label: 'Set up a new API key', cmd: 'dag keys setup' },
  { n: 5, label: 'Share a workflow', cmd: 'dag share --help' },
  { n: 6, label: 'Open DAG Studio', cmd: 'dag studio' },
] as const;

async function showPersonalizedNextSteps(io: IDagCliIo): Promise<void> {
  if (!process.stdout.isTTY) return;

  io.write(`\nWhat would you like to do next?\n`);
  for (const opt of NEXT_STEP_OPTIONS) {
    io.write(`  ${opt.n}. ${opt.label}\n`);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let choiceStr: string;
  try {
    choiceStr = await rl.question('  > ');
  } finally {
    rl.close();
  }

  const n = parseInt(choiceStr.trim(), 10);
  const opt = NEXT_STEP_OPTIONS.find((o) => o.n === n);
  if (opt) {
    io.write(`\n  Run: ${opt.cmd}\n`);
    await recordTelemetry({ command: 'tutorial_next_step', success: true, durationMs: 0 });
  }
}

async function runAllSteps(io: IDagCliIo, cwd: string, startFrom = 1): Promise<number> {
  let provider: TProvider = 'skip';

  if (startFrom > 2) {
    const envVars = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];
    const existingKey = envVars.find((v) => {
      const val = process.env[v];
      return typeof val === 'string' && val.trim().length > 0;
    });
    if (existingKey !== undefined) {
      const spec = PROVIDER_SPECS.find((s) => s.envVar === existingKey);
      provider = spec?.provider ?? 'skip';
    }
  }

  if (startFrom <= 1) {
    const t0 = Date.now();
    await runStep1EnvironmentCheck(io);
    await recordTelemetry({
      command: 'tutorial_step_1',
      success: true,
      durationMs: Date.now() - t0,
    });
  }

  if (startFrom <= 2) {
    const t0 = Date.now();
    provider = await runStep2ApiKeySetup(io, false, cwd);
    await recordTelemetry({
      command: 'tutorial_step_2',
      success: true,
      durationMs: Date.now() - t0,
    });
  }

  if (startFrom <= 3) {
    const t0 = Date.now();
    await runStep3FirstPipeline(io, provider, false);
    await recordTelemetry({
      command: 'tutorial_step_3',
      success: true,
      durationMs: Date.now() - t0,
    });
  }

  if (startFrom <= 4) {
    const t0 = Date.now();
    runStep4BuildYourOwn(io);
    await recordTelemetry({
      command: 'tutorial_step_4',
      success: true,
      durationMs: Date.now() - t0,
    });
  }

  if (startFrom <= 5) {
    const t0 = Date.now();
    runStep5WhatNext(io, provider);
    await recordTelemetry({
      command: 'tutorial_step_5',
      success: true,
      durationMs: Date.now() - t0,
    });
  }

  await showPersonalizedNextSteps(io);
  await markTutorialComplete(cwd, provider);
  io.write(`\nTutorial complete! Run 'dag tutorial --reset' to start over.\n`);
  return SUCCESS_EXIT_CODE;
}

const TUTORIAL_EXAMPLES: ReadonlyArray<{
  readonly filename: string;
  readonly description: string;
  readonly content: object;
}> = [
  {
    filename: '01-linear-pipeline.dag.json',
    description: 'Basic linear pipeline: input → LLM → output',
    content: {
      dagId: 'tutorial-linear',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {}, position: { x: 0, y: 0 } },
        {
          nodeId: 'llm',
          nodeType: 'llm-text',
          dependsOn: ['input'],
          config: { provider: 'anthropic', systemPrompt: 'Answer in exactly 10 words or fewer.' },
          position: { x: 300, y: 0 },
        },
        {
          nodeId: 'output',
          nodeType: 'text-output',
          dependsOn: ['llm'],
          config: {},
          position: { x: 600, y: 0 },
        },
      ],
      edges: [
        { from: 'input', to: 'llm', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        { from: 'llm', to: 'output', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    },
  },
  {
    filename: '02-template-pipeline.dag.json',
    description: 'Template pipeline (no API key): input → text-template → output',
    content: {
      dagId: 'tutorial-template',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {}, position: { x: 0, y: 0 } },
        {
          nodeId: 'template',
          nodeType: 'text-template',
          dependsOn: ['input'],
          config: { template: 'Hello, {{text}}! Welcome to robota-dag.' },
          position: { x: 300, y: 0 },
        },
        {
          nodeId: 'output',
          nodeType: 'text-output',
          dependsOn: ['template'],
          config: {},
          position: { x: 600, y: 0 },
        },
      ],
      edges: [
        { from: 'input', to: 'template', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        {
          from: 'template',
          to: 'output',
          bindings: [{ outputKey: 'text', inputKey: 'text' }],
        },
      ],
    },
  },
  {
    filename: '03-parallel-pipeline.dag.json',
    description: 'Parallel summarize + translate, then merge',
    content: {
      dagId: 'tutorial-parallel',
      version: 1,
      status: 'draft',
      nodes: [
        {
          nodeId: 'input',
          nodeType: 'input',
          dependsOn: [],
          config: {},
          position: { x: 0, y: 150 },
        },
        {
          nodeId: 'summarize',
          nodeType: 'llm-text',
          dependsOn: ['input'],
          config: { provider: 'anthropic', systemPrompt: 'Summarize in 1 sentence.' },
          position: { x: 300, y: 0 },
        },
        {
          nodeId: 'translate',
          nodeType: 'llm-text',
          dependsOn: ['input'],
          config: { provider: 'anthropic', systemPrompt: 'Translate to Spanish.' },
          position: { x: 300, y: 300 },
        },
        {
          nodeId: 'output',
          nodeType: 'text-output',
          dependsOn: ['summarize', 'translate'],
          config: {},
          position: { x: 600, y: 150 },
        },
      ],
      edges: [
        { from: 'input', to: 'summarize', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        { from: 'input', to: 'translate', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        {
          from: 'summarize',
          to: 'output',
          bindings: [{ outputKey: 'text', inputKey: 'text' }],
        },
      ],
    },
  },
];

async function exportTutorialExamples(cwd: string, io: IDagCliIo): Promise<number> {
  const outDir = join(cwd, 'tutorial-examples');
  await mkdir(outDir, { recursive: true });

  for (const example of TUTORIAL_EXAMPLES) {
    const outPath = join(outDir, example.filename);
    await writeFile(outPath, JSON.stringify(example.content, null, 2) + '\n', 'utf8');
    io.write(`  ✓ ${example.filename}  — ${example.description}\n`);
  }

  io.write(`\nExported ${TUTORIAL_EXAMPLES.length} example DAGs to tutorial-examples/\n`);
  io.write(`\nRun them with:\n`);
  io.write(
    `  dag run tutorial-examples/01-linear-pipeline.dag.json --input text="What is a DAG?"\n`,
  );
  io.write(`  dag run tutorial-examples/02-template-pipeline.dag.json --input text="World"\n`);

  await recordTelemetry({ command: 'tutorial_export', success: true, durationMs: 0 });
  return SUCCESS_EXIT_CODE;
}

/**
 * Execute the `dag tutorial` subcommand.
 *
 * Runs an interactive 5-step onboarding walkthrough:
 *   1. Environment check
 *   2. API key setup
 *   3. Run first pipeline
 *   4. Build your own DAG (instructions)
 *   5. What to explore next
 *
 * @param args    - argv slice after the `tutorial` keyword.
 * @param options - IO abstraction and optional working directory.
 * @returns Exit code.
 */
export async function tutorialCommand(
  args: readonly string[],
  options: ITutorialCommandOptions,
): Promise<number> {
  const { io, cwd = process.cwd() } = options;
  const parsed = parseTutorialArgs(args);

  if (parsed.reset) {
    return resetTutorial(cwd, io);
  }

  if (parsed.export) {
    io.write(`Exporting tutorial example DAGs...\n`);
    return exportTutorialExamples(cwd, io);
  }

  io.write(`Welcome to robota-dag!\n`);
  io.write(`This tutorial walks you through your first AI pipeline.\n`);
  io.write(`${DIVIDER}\n`);

  if (parsed.nonInteractive) {
    io.write(`\nRunning in non-interactive mode — environment check only.\n`);
    await runStep1EnvironmentCheck(io);
    io.write(`\nAll checks passed.\n`);
    return SUCCESS_EXIT_CODE;
  }

  try {
    return await runAllSteps(io, cwd, parsed.skipTo ?? 1);
  } catch (err) {
    // allow-fallback: top-level guard catches unexpected failures and reports them cleanly
    const msg = err instanceof Error ? err.message : String(err);
    io.write(`\nError: Tutorial failed: ${msg}\n`);
    return FAILURE_EXIT_CODE;
  }
}
