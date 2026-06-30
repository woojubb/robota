import { mkdir, writeFile, access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IDagCliIo } from '../types.js';

const USAGE_ERROR_EXIT_CODE = 2;
const SUCCESS_EXIT_CODE = 0;

const TEMPLATES = ['hello-world', 'code-review', 'summarize'] as const;
type TTemplate = (typeof TEMPLATES)[number];

const PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
type TProvider = (typeof PROVIDERS)[number];

interface IInitCommandOptions {
  io: IDagCliIo;
}

interface IInitArgs {
  directory: string;
  template: TTemplate;
  provider: TProvider;
  claude: boolean;
  noCta: boolean;
  team: boolean;
}

function parseArgs(
  args: readonly string[],
): { ok: true; value: IInitArgs } | { ok: false; message: string } {
  let directory = '.';
  let template: TTemplate = 'hello-world';
  let provider: TProvider = 'anthropic';
  let claude = false;
  let noCta = false;
  let team = false;

  const rest = [...args];
  while (rest.length > 0) {
    const arg = rest.shift()!;
    if (arg === '--no-cta') {
      noCta = true;
      continue;
    }
    if (arg === '--team') {
      team = true;
      continue;
    }
    if (arg === '--template') {
      const val = rest.shift();
      if (!val) return { ok: false, message: '--template requires a value' };
      if (!(TEMPLATES as readonly string[]).includes(val)) {
        return {
          ok: false,
          message: `Unknown template "${val}". Available: ${TEMPLATES.join(', ')}`,
        };
      }
      template = val as TTemplate;
    } else if (arg === '--provider') {
      const val = rest.shift();
      if (!val) return { ok: false, message: '--provider requires a value' };
      if (!(PROVIDERS as readonly string[]).includes(val)) {
        return {
          ok: false,
          message: `Unknown provider "${val}". Available: ${PROVIDERS.join(', ')}`,
        };
      }
      provider = val as TProvider;
    } else if (arg === '--claude') {
      claude = true;
    } else if (!arg.startsWith('-')) {
      directory = arg;
    }
  }

  return { ok: true, value: { directory, template, provider, claude, noCta, team } };
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false, // allow-fallback: fs.access throws on not-found; false is the correct semantic
  );
}

function buildHelloWorldDag(provider: TProvider): object {
  const llmNodeType =
    provider === 'openai'
      ? 'llm-text-openai'
      : provider === 'gemini'
        ? 'llm-text-gemini'
        : 'llm-text-anthropic';
  const defaultModel =
    provider === 'openai'
      ? 'gpt-4o-mini'
      : provider === 'gemini'
        ? 'gemini-2.0-flash'
        : 'claude-haiku-4-5-20251001';

  return {
    dagId: 'hello-world',
    version: 1,
    status: 'draft',
    nodes: [
      {
        nodeId: 'input',
        nodeType: 'input',
        dependsOn: [],
        config: {},
        position: { x: 100, y: 200 },
      },
      {
        nodeId: 'llm',
        nodeType: llmNodeType,
        dependsOn: ['input'],
        config: {
          model: defaultModel,
          systemPrompt: 'You are a helpful assistant. Answer concisely.',
        },
        position: { x: 400, y: 200 },
      },
      {
        nodeId: 'output',
        nodeType: 'text-output',
        dependsOn: ['llm'],
        config: {},
        position: { x: 700, y: 200 },
      },
    ],
    edges: [
      { from: 'input', to: 'llm', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      { from: 'llm', to: 'output', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
    ],
  };
}

function buildEnvExample(provider: TProvider): string {
  const lines = ['# robota-dag API Keys', '# Copy this file to .env and fill in your keys.', ''];
  if (provider === 'anthropic') {
    lines.push('ANTHROPIC_API_KEY=');
    lines.push('# OPENAI_API_KEY=');
    lines.push('# GEMINI_API_KEY=');
  } else if (provider === 'openai') {
    lines.push('# ANTHROPIC_API_KEY=');
    lines.push('OPENAI_API_KEY=');
    lines.push('# GEMINI_API_KEY=');
  } else {
    lines.push('# ANTHROPIC_API_KEY=');
    lines.push('# OPENAI_API_KEY=');
    lines.push('GEMINI_API_KEY=');
  }
  lines.push('# DEEPSEEK_API_KEY=');
  lines.push('# DASHSCOPE_API_KEY=');
  return lines.join('\n') + '\n';
}

function buildReadme(provider: TProvider): string {
  const providerKey =
    provider === 'openai'
      ? 'OPENAI_API_KEY'
      : provider === 'gemini'
        ? 'GEMINI_API_KEY'
        : 'ANTHROPIC_API_KEY';
  return `# DAG Workflows

## Quick Start

1. Copy \`.dag/.env.example\` to \`.dag/.env\` and set your API key:

   \`\`\`
   ${providerKey}=your-key-here
   \`\`\`

2. Run the hello world example:

   \`\`\`
   dag run .dag/workflows/hello-world.dag.json --input text="What is a DAG?"
   \`\`\`

3. Edit or create workflow files in \`.dag/workflows/\`

## Commands

- \`dag run <file> --input key=value\` — Execute a DAG locally
- \`dag validate <file>\` — Validate without running
- \`dag node list\` — Browse available node types
- \`dag node info <type>\` — Show node details
`;
}

function buildHelloWorldDagMd(provider: TProvider): string {
  const llmNode =
    provider === 'openai'
      ? 'llm-text-openai'
      : provider === 'gemini'
        ? 'llm-text-gemini'
        : 'llm-text-anthropic';
  return `---
dagId: hello-world
description: Simple question-answering pipeline powered by robota-dag
dag:
  nodes:
    input:
      nodeType: input
    llm:
      nodeType: ${llmNode}
      dependsOn: [input]
    output:
      nodeType: text-output
      dependsOn: [llm]
---

# Hello World Pipeline

A simple question-answering pipeline built with [robota-dag](https://github.com/woojubb/robota).

\`\`\`mermaid
flowchart LR
  input["📥 input"]-->llm["🤖 ${llmNode}"]
  llm-->output["📤 text-output"]
\`\`\`

## Run this workflow

\`\`\`bash
dag run .dag/workflows/hello-world.dag.json --input text="What is a DAG?"
\`\`\`

Built with [robota-dag](https://github.com/woojubb/robota) — AI workflow orchestration without a server.
`;
}

const GITIGNORE_ADDITION = `
# Environment files with API keys — never commit these
.env
.env.local
.env.*.local

# DAG local state
.dag/.env
.dag-storage/
`;

const MCP_SERVER_ENTRY = {
  command: 'npx',
  args: ['@robota-sdk/dag-cli', 'mcp'],
} as const;

interface IMcpServerEntry {
  command: string;
  args: string[];
}

interface IMcpJson {
  mcpServers: Record<string, IMcpServerEntry>;
  [key: string]: unknown;
}

async function writeMcpJson(directory: string, io: IDagCliIo): Promise<void> {
  const claudeDir = join(directory, '.claude');
  const mcpJsonPath = join(claudeDir, 'mcp.json');

  await mkdir(claudeDir, { recursive: true });

  let existing: IMcpJson = { mcpServers: {} };
  const exists = await pathExists(mcpJsonPath);
  if (exists) {
    const raw = await readFile(mcpJsonPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (_parseError) {
      // allow-fallback: malformed mcp.json is reset to a valid config
      parsed = null;
    }
    if (parsed !== null && typeof parsed === 'object') {
      const parsedObj = parsed as Record<string, unknown>;
      existing = {
        ...parsedObj,
        mcpServers:
          parsedObj['mcpServers'] !== null &&
          typeof parsedObj['mcpServers'] === 'object' &&
          !Array.isArray(parsedObj['mcpServers'])
            ? (parsedObj['mcpServers'] as Record<string, IMcpServerEntry>)
            : {},
      };
    }
  }

  existing.mcpServers['robota-dag'] = {
    command: MCP_SERVER_ENTRY.command,
    args: [...MCP_SERVER_ENTRY.args],
  };
  await writeFile(mcpJsonPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

  io.write(`\n✓ .claude/mcp.json configured\n`);
  io.write(`\n  MCP server: robota-dag\n`);
  io.write(`  Command: npx @robota-sdk/dag-cli mcp\n`);
  io.write(`\nRestart Claude Code to activate MCP tools.\n`);
  io.write(`Next: Ask Claude — "Build me an AI pipeline that summarizes text"\n`);
}

const DEFAULT_LINT_JSON =
  JSON.stringify(
    { rules: { 'naming-convention': 'warn', 'require-input-node': 'error' } },
    null,
    2,
  ) + '\n';

const DAG_CI_YML_CONTENT = `# dag-ci.yml — DAG workflow quality gate for your repository
#
# Drop this file into .github/workflows/ in any repo that uses robota-dag DAG files.
# It validates and lints all .dag.json files on every PR.
#
# Requirements:
#   - DAG files live under .dag/workflows/ (configurable via DAG_DIR below)
#   - No API keys needed — validation and lint are static checks

name: DAG Quality Gate

on:
  pull_request:
    paths:
      - '**.dag.json'
      - '**.dag.robota.json'
      - '.dag/**'

jobs:
  validate-and-lint:
    name: Validate & Lint DAG files
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dag CLI
        run: npm install -g @robota-sdk/dag-cli

      - name: Validate DAG files
        run: |
          echo "=== Validating DAG files ==="
          find . -name "*.dag.json" -not -path "*/node_modules/*" | while read f; do
            echo "Validating: $f"
            dag validate "$f"
          done

      - name: Lint DAG files
        run: |
          echo "=== Linting DAG files ==="
          DAG_DIR="\${DAG_DIR:-.dag/workflows}"
          if [ -d "$DAG_DIR" ]; then
            dag lint "$DAG_DIR" --strict
          else
            echo "No $DAG_DIR directory found. Linting individual files."
            find . -name "*.dag.json" -not -path "*/node_modules/*" -exec dag lint {} \\;
          fi

      - name: Cost estimate (informational)
        if: always()
        run: |
          echo "=== Cost estimates (informational) ==="
          find . -name "*.dag.json" -not -path "*/node_modules/*" | while read f; do
            echo ""
            echo "Cost estimate for: $f"
            dag cost estimate "$f" || true
          done
        continue-on-error: true
`;

interface IWorkflowInfo {
  readonly file: string;
  readonly dagId: string;
  readonly description: string;
}

async function scanWorkflows(workflowsDir: string): Promise<IWorkflowInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(workflowsDir);
  } catch (_err) {
    // allow-fallback: workflows dir not yet created; return empty list
    return [];
  }
  const results: IWorkflowInfo[] = [];
  for (const fileName of entries.filter((e) => e.endsWith('.dag.json'))) {
    let raw: string;
    try {
      raw = await readFile(join(workflowsDir, fileName), 'utf8');
    } catch (_err) {
      // allow-fallback: unreadable workflow file is skipped
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (_err) {
      // allow-fallback: unparseable workflow file is skipped
      continue;
    }
    const dagId =
      typeof parsed['dagId'] === 'string' ? parsed['dagId'] : fileName.replace('.dag.json', '');
    const description = typeof parsed['description'] === 'string' ? parsed['description'] : '';
    results.push({ file: fileName, dagId, description });
  }
  return results;
}

const HUSKY_PRE_COMMIT = `#!/bin/sh
dag lint .dag/workflows/ --quiet || exit 1
`;

async function tryWriteHuskyHook(directory: string, io: IDagCliIo): Promise<boolean> {
  const huskyBin = join(directory, 'node_modules', '.bin', 'husky');
  const huskyExists = await pathExists(huskyBin);
  if (!huskyExists) return false;
  const huskyDir = join(directory, '.husky');
  await mkdir(huskyDir, { recursive: true });
  const hookPath = join(huskyDir, 'pre-commit');
  if (await pathExists(hookPath)) {
    io.write(`  .husky/pre-commit (skipped, already exists)\n`);
  } else {
    await writeFile(hookPath, HUSKY_PRE_COMMIT, { encoding: 'utf8', mode: 0o755 });
    io.write(`  .husky/pre-commit   dag lint pre-commit hook\n`);
  }
  return true;
}

function buildDagMd(workflows: readonly IWorkflowInfo[]): string {
  const tableRows =
    workflows.length > 0
      ? workflows.map((w) => `| \`${w.file}\` | ${w.dagId} | ${w.description || '—'} |`).join('\n')
      : '| (none yet) | — | — |';

  return `# DAG Workflows

This folder contains the team's AI pipeline workflows.

## Quick Start
1. \`dag keys add anthropic\` — Set your API key
2. \`dag run .dag/workflows/hello-world.dag.json --input text="Hello"\` — Run your first workflow

## Workflow List

| File | ID | Description |
| ---- | -- | ----------- |
${tableRows}

## Commands
- \`dag run <file> --input key=value\` — Execute a workflow locally
- \`dag validate <file>\` — Validate without running
- \`dag node list\` — Browse available node types
`;
}

async function writeTeamFiles(directory: string, dagDir: string, io: IDagCliIo): Promise<void> {
  const githubWorkflowsDir = join(directory, '.github', 'workflows');
  await mkdir(githubWorkflowsDir, { recursive: true });

  const workflowsDir = join(dagDir, 'workflows');
  const workflows = await scanWorkflows(workflowsDir);

  const teamFiles: Array<{ path: string; content: string; label: string }> = [
    {
      path: join(dagDir, 'lint.json'),
      content: DEFAULT_LINT_JSON,
      label: '.dag/lint.json',
    },
    {
      path: join(githubWorkflowsDir, 'dag-ci.yml'),
      content: DAG_CI_YML_CONTENT,
      label: '.github/workflows/dag-ci.yml',
    },
    {
      path: join(directory, 'DAG.md'),
      content: buildDagMd(workflows),
      label: 'DAG.md',
    },
  ];

  io.write(`\nInitializing team setup...\n\n`);
  io.write(`Created files:\n`);

  for (const f of teamFiles) {
    if (await pathExists(f.path)) {
      io.write(`  ${f.label} (skipped, already exists)\n`);
    } else {
      await writeFile(f.path, f.content, 'utf8');
      io.write(`  ${f.path}   ${f.label}\n`);
    }
  }

  await tryWriteHuskyHook(directory, io);

  io.write(`\n✓ Team setup complete!\n`);
  io.write(`\nShare with your team:\n`);
  io.write(`  1. git add .dag/ .github/workflows/dag-ci.yml DAG.md && git commit\n`);
  io.write(`  2. Team members run: dag doctor\n`);
  io.write(`  3. Team members run: dag keys add anthropic\n`);
}

const INIT_HELP_TEXT = [
  'Usage: dag init [directory] [options]',
  '',
  'Initialize a robota-dag project scaffold.',
  '',
  'Arguments:',
  '  [directory]              Target directory (default: current directory)',
  '',
  'Options:',
  '  --template <name>        Workflow template: hello-world (default), code-review, summarize',
  '  --provider <name>        LLM provider: anthropic (default), openai, gemini',
  '  --claude                 Add .claude/mcp.json for Claude Code integration',
  '  --team                   Add team files: lint.json, dag-ci.yml, DAG.md',
  '  --no-cta                 Suppress the next-steps call-to-action',
  '  --help                   Show this help message',
  '',
].join('\n');

export async function initCommand(
  args: readonly string[],
  options: IInitCommandOptions,
): Promise<number> {
  const { io } = options;

  if (args.includes('--help') || args.includes('-h')) {
    io.write(INIT_HELP_TEXT);
    return SUCCESS_EXIT_CODE;
  }

  const parsed = parseArgs(args);
  if (!parsed.ok) {
    io.write(
      `Error: ${parsed.message}\nUsage: dag init [directory] [--template <name>] [--provider <name>] [--team]\n`,
    );
    return USAGE_ERROR_EXIT_CODE;
  }

  const { directory, template, provider, claude, noCta, team } = parsed.value;
  const dagDir = join(directory, '.dag');
  const workflowsDir = join(dagDir, 'workflows');

  const dagDirExists = await pathExists(dagDir);
  if (dagDirExists) {
    io.write(`Warning: ${dagDir} already exists. Skipping existing files.\n`);
  }

  const files: Array<{ path: string; content: string }> = [
    {
      path: join(workflowsDir, 'hello-world.dag.json'),
      content: JSON.stringify(buildHelloWorldDag(provider), null, 2) + '\n',
    },
    {
      path: join(workflowsDir, 'hello-world.dag.md'),
      content: buildHelloWorldDagMd(provider),
    },
    { path: join(dagDir, '.env.example'), content: buildEnvExample(provider) },
    { path: join(directory, 'README-DAG.md'), content: buildReadme(provider) },
    { path: join(directory, '.gitignore'), content: GITIGNORE_ADDITION },
  ];

  await mkdir(workflowsDir, { recursive: true });

  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (await pathExists(file.path)) {
      skipped.push(file.path);
    } else {
      await writeFile(file.path, file.content, 'utf8');
      written.push(file.path);
    }
  }

  io.write(`Initialized dag project in ${directory}\n\n`);
  for (const f of written) io.write(`  ✓ ${f}\n`);
  for (const f of skipped) io.write(`  - ${f} (skipped, already exists)\n`);

  const providerKey =
    provider === 'openai'
      ? 'OPENAI_API_KEY'
      : provider === 'gemini'
        ? 'GEMINI_API_KEY'
        : 'ANTHROPIC_API_KEY';

  const isCi = process.env['CI'] === 'true';
  if (!noCta && !isCi) {
    const divider = '────────────────────────────────────────';
    io.write(
      `\n${divider}\n3 things to do next:\n\n  1. Set your API key\n     dag keys add ${provider}\n\n  2. Run your first workflow\n     dag run ${workflowsDir}/hello-world.dag.json --input text="Hello"\n\n  3. Understand the structure\n     dag explain ${workflowsDir}/hello-world.dag.json\n\nFull guide: dag tutorial\n${divider}\n`,
    );
  } else {
    io.write(
      `\nNext steps:\n  1. Set your API key: echo '${providerKey}=...' >> ${dagDir}/.env\n  2. Run: dag run ${workflowsDir}/hello-world.dag.json --input text="Hello!"\n`,
    );
  }

  if (template !== 'hello-world') {
    io.write(`\nNote: template "${template}" is not yet implemented. hello-world was used.\n`);
  }

  if (claude) {
    await writeMcpJson(directory, io);
  }

  if (team) {
    await writeTeamFiles(directory, dagDir, io);
  }

  return SUCCESS_EXIT_CODE;
}
