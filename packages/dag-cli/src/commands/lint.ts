import { readdir, readFile, stat, access } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { IDagDefinition, IDagNode, IDagEdgeDefinition } from '@robota-sdk/dag-core';
import type { IDagCliIo } from '../types.js';
import { SUCCESS_EXIT_CODE, FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTPUT_FORMAT_PRETTY = 'pretty';
const OUTPUT_FORMAT_JSON = 'json';
const JSON_INDENT_SPACES = 2;
const CONFIG_EXIT_CODE = 2;

const LINT_HELP_TEXT = `dag lint — lint DAG workflow files for best-practice violations

Usage:
  dag lint <file|directory>       Lint a single file or all *.dag.json in a directory
  dag lint --show-hook            Print a .pre-commit-config.yaml snippet

Flags:
  --strict                        Treat warnings as errors (exit 1)
  --output json                   JSON output instead of pretty text
  --show-hook                     Print pre-commit hook configuration snippet
  --rules-url <url>               Load additional lint rules from a remote URL (local rules take precedence)
  --rules-pkg <package>           Load lint rules from an installed npm package (e.g. robota-dag-rules-strict)

Rules:
  require-input-node (error)      Workflow must contain at least one input node
  no-disconnected-nodes (error)   Every non-input node must be reachable via edges
  naming-convention (warn)        Node IDs must match /^[a-z][a-z0-9-]*$/ and be >= 3 chars
  max-cost-per-run (warn)         Estimated run cost must not exceed $1.00
  max-nodes (warn)                Node count must not exceed 20

Config: .dag/lint.json (optional rule overrides)

Exit codes: 0 = clean, 1 = errors (or warnings with --strict), 2 = config error
`;

const PRE_COMMIT_SNIPPET = `# .pre-commit-config.yaml — add to your repo root
repos:
  - repo: local
    hooks:
      - id: dag-lint
        name: dag lint
        entry: dag lint
        language: system
        files: \\.dag\\.json$
        pass_filenames: true
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TRuleSeverity = 'error' | 'warn' | 'off';
type TRuleConfig = TRuleSeverity | [TRuleSeverity, ...unknown[]];

export interface ILintConfig {
  readonly extends?: readonly string[];
  readonly rules: Record<string, TRuleConfig>;
}

interface ILintFinding {
  readonly ruleId: string;
  readonly severity: TRuleSeverity;
  readonly message: string;
}

interface IFileLintResult {
  readonly file: string;
  readonly findings: ILintFinding[];
  readonly parseError: string | null;
}

interface IParsedLintOptions {
  readonly targets: string[];
  readonly strict: boolean;
  readonly outputFormat: string;
  readonly showHook: boolean;
  readonly rulesUrl: string | undefined;
  readonly rulesPkg: string | undefined;
}

type TParseResult =
  | { readonly ok: true; readonly value: IParsedLintOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

export interface ILintCommandOptions {
  readonly io: IDagCliIo;
  readonly cwd?: string;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseLintArgv(args: readonly string[]): TParseResult {
  // Show help
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: false, exitCode: SUCCESS_EXIT_CODE, message: LINT_HELP_TEXT };
  }

  const mutableArgs = [...args];

  // --show-hook
  const showHookIdx = mutableArgs.indexOf('--show-hook');
  const showHook = showHookIdx !== -1;
  if (showHook) mutableArgs.splice(showHookIdx, 1);

  // --strict
  const strictIdx = mutableArgs.indexOf('--strict');
  const strict = strictIdx !== -1;
  if (strict) mutableArgs.splice(mutableArgs.indexOf('--strict'), 1);

  // --output <format>
  const outputIdx = mutableArgs.indexOf('--output');
  let outputFormat = OUTPUT_FORMAT_PRETTY;
  if (outputIdx !== -1) {
    const val = mutableArgs[outputIdx + 1];
    if (typeof val !== 'string' || val.startsWith('--')) {
      return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--output requires a value.' };
    }
    if (val !== OUTPUT_FORMAT_PRETTY && val !== OUTPUT_FORMAT_JSON) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--output must be "json" or "pretty".',
      };
    }
    outputFormat = val;
    mutableArgs.splice(outputIdx, 2);
  }

  // --rules-url <url>
  const rulesUrlIdx = mutableArgs.indexOf('--rules-url');
  let rulesUrl: string | undefined;
  if (rulesUrlIdx !== -1) {
    const val = mutableArgs[rulesUrlIdx + 1];
    if (typeof val !== 'string' || val.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--rules-url requires a URL value.',
      };
    }
    rulesUrl = val;
    mutableArgs.splice(rulesUrlIdx, 2);
  }

  // --rules-pkg <package>
  const rulesPkgIdx = mutableArgs.indexOf('--rules-pkg');
  let rulesPkg: string | undefined;
  if (rulesPkgIdx !== -1) {
    const val = mutableArgs[rulesPkgIdx + 1];
    if (typeof val !== 'string' || val.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: '--rules-pkg requires a package name.',
      };
    }
    rulesPkg = val;
    mutableArgs.splice(rulesPkgIdx, 2);
  }

  const unknownFlags = mutableArgs.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `lint received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  const targets = mutableArgs.filter((a) => !a.startsWith('--'));

  if (!showHook && targets.length === 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: 'lint requires a <file|directory> argument. Run: dag lint --help',
    };
  }

  return { ok: true, value: { targets, strict, outputFormat, showHook, rulesUrl, rulesPkg } };
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

const REMOTE_RULES_TIMEOUT_MS = 5000; // eslint-disable-line @typescript-eslint/no-magic-numbers

async function fetchRemoteRules(url: string, io: IDagCliIo): Promise<ILintConfig['rules'] | null> {
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_RULES_TIMEOUT_MS);
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      io.write(`⚠ 원격 규칙 로드 실패: ${url} — 로컬 규칙만 사용합니다\n`);
      return null;
    }
    const json = (await response.json()) as unknown;
    if (
      typeof json === 'object' &&
      json !== null &&
      'rules' in json &&
      typeof (json as Record<string, unknown>)['rules'] === 'object'
    ) {
      return (json as { rules: ILintConfig['rules'] }).rules;
    }
    io.write(`⚠ 원격 규칙 형식 오류: ${url} — 로컬 규칙만 사용합니다\n`);
    return null;
  } catch (networkErr) {
    // allow-fallback: network errors (timeout, DNS) fall back to local-only rules
    io.write(`⚠ 원격 규칙 로드 실패: ${url} — 로컬 규칙만 사용합니다\n`);
    void networkErr;
    return null;
  }
}

interface IPkgRulesModule {
  rules?: Record<string, string>;
}

function loadPkgRules(pkgName: string, io: IDagCliIo): ILintConfig['rules'] | null {
  const require = createRequire(fileURLToPath(import.meta.url));
  let mod: IPkgRulesModule;
  try {
    mod = require(pkgName) as IPkgRulesModule;
  } catch (loadErr) {
    // allow-fallback: package not installed; warn and continue with local rules
    const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
    io.write(`⚠ ${pkgName}: cannot load (${msg}) — local rules only\n`);
    return null;
  }
  if (typeof mod.rules === 'object' && mod.rules !== null) {
    return mod.rules as ILintConfig['rules'];
  }
  io.write(`⚠ ${pkgName}: "rules" export not found — local rules only\n`);
  return null;
}

const DEFAULT_RULE_SEVERITIES: Record<string, TRuleSeverity> = {
  'require-input-node': 'error',
  'no-disconnected-nodes': 'error',
  'naming-convention': 'warn',
  'max-cost-per-run': 'warn',
  'max-nodes': 'warn',
};

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false, // allow-fallback: fs.access throws on not-found; false is the correct semantic
  );
}

async function loadLintConfig(
  cwd: string,
): Promise<{ ok: true; config: ILintConfig } | { ok: false; message: string }> {
  const configPath = join(cwd, '.dag', 'lint.json');
  const exists = await pathExists(configPath);
  if (!exists) {
    return { ok: true, config: { rules: {} } };
  }

  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch (err) {
    // allow-fallback: config read failure is reported as config error, not crash
    return {
      ok: false,
      message: `Failed to read .dag/lint.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    // allow-fallback: JSON parse error is reported as config error, not crash
    return {
      ok: false,
      message: `Failed to parse .dag/lint.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: '.dag/lint.json must be a JSON object.' };
  }

  const obj = parsed as Record<string, unknown>;

  const extendsRaw = obj['extends'];
  if (extendsRaw !== undefined) {
    if (!Array.isArray(extendsRaw) || !extendsRaw.every((e) => typeof e === 'string')) {
      return { ok: false, message: '.dag/lint.json "extends" must be a string array.' };
    }
  }

  const rulesRaw = obj['rules'];
  if (rulesRaw !== undefined && (typeof rulesRaw !== 'object' || rulesRaw === null)) {
    return { ok: false, message: '.dag/lint.json "rules" must be an object.' };
  }

  return {
    ok: true,
    config: {
      extends: extendsRaw as string[] | undefined,
      rules: (rulesRaw as Record<string, TRuleConfig>) ?? {},
    },
  };
}

function resolveRuleSeverity(ruleId: string, config: ILintConfig, strict: boolean): TRuleSeverity {
  const override = config.rules[ruleId];
  let severity: TRuleSeverity;
  if (override === undefined) {
    severity = DEFAULT_RULE_SEVERITIES[ruleId] ?? 'warn';
  } else if (Array.isArray(override)) {
    severity = (override[0] as TRuleSeverity) ?? 'warn';
  } else {
    severity = override;
  }

  if (strict && severity === 'warn') return 'error';
  return severity;
}

function getRuleThreshold(ruleId: string, config: ILintConfig, defaultVal: number): number {
  const override = config.rules[ruleId];
  if (Array.isArray(override) && typeof override[1] === 'number') {
    return override[1] as number;
  }
  return defaultVal;
}

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

const NAMING_CONVENTION_RE = /^[a-z][a-z0-9-]*$/;
const NAMING_CONVENTION_MIN_LENGTH = 3;
const DEFAULT_MAX_COST_USD = 1.0;
const DEFAULT_MAX_NODES = 20;
// Rough cost per token in USD (based on median mid-tier LLM pricing)
const APPROX_COST_PER_TOKEN_USD = 0.000003;
const APPROX_TOKENS_PER_CHAR = 0.25;

function estimateRunCostUsd(dag: IDagDefinition): number {
  // Sum costPolicy.runCreditLimit across nodes as a best-effort estimate.
  // 1 credit ≈ $0.01 by convention; if not set, estimate from LLM node count.
  const nodes = dag.nodes ?? [];
  let totalCredits = 0;
  for (const node of nodes) {
    if (node.costPolicy?.runCreditLimit !== undefined) {
      totalCredits += node.costPolicy.runCreditLimit;
    }
  }
  if (totalCredits > 0) {
    return totalCredits * 0.01;
  }
  // Fallback: each LLM node ≈ 1000 tokens at $0.000003/token
  const llmLikeNodes = nodes.filter(
    (n) =>
      n.nodeType.includes('llm') ||
      n.nodeType.includes('ai') ||
      n.nodeType.includes('chat') ||
      n.nodeType.includes('embed'),
  );
  return llmLikeNodes.length * 1000 * APPROX_TOKENS_PER_CHAR * APPROX_COST_PER_TOKEN_USD;
}

function buildEdgeTargetSet(edges: IDagEdgeDefinition[]): Set<string> {
  const targets = new Set<string>();
  for (const edge of edges) {
    targets.add(edge.to);
  }
  return targets;
}

function buildEdgeSourceSet(edges: IDagEdgeDefinition[]): Set<string> {
  const sources = new Set<string>();
  for (const edge of edges) {
    sources.add(edge.from);
  }
  return sources;
}

const INPUT_NODE_TYPES = ['input', 'multi-input'];

function lintDag(dag: IDagDefinition, config: ILintConfig, strict: boolean): ILintFinding[] {
  const findings: ILintFinding[] = [];
  const nodes: IDagNode[] = dag.nodes ?? [];
  const edges: IDagEdgeDefinition[] = dag.edges ?? [];

  // Rule: require-input-node
  {
    const severity = resolveRuleSeverity('require-input-node', config, strict);
    if (severity !== 'off') {
      const hasInput = nodes.some((n) => INPUT_NODE_TYPES.includes(n.nodeType));
      if (!hasInput) {
        findings.push({
          ruleId: 'require-input-node',
          severity,
          message: 'No input node found',
        });
      }
    }
  }

  // Rule: no-disconnected-nodes
  {
    const severity = resolveRuleSeverity('no-disconnected-nodes', config, strict);
    if (severity !== 'off' && nodes.length > 1) {
      const edgeTargets = buildEdgeTargetSet(edges);
      const edgeSources = buildEdgeSourceSet(edges);
      for (const node of nodes) {
        if (INPUT_NODE_TYPES.includes(node.nodeType)) continue;
        // A node is disconnected if it has neither incoming nor outgoing edges
        const hasIncoming = edgeTargets.has(node.nodeId);
        const hasOutgoing = edgeSources.has(node.nodeId);
        if (!hasIncoming && !hasOutgoing) {
          findings.push({
            ruleId: 'no-disconnected-nodes',
            severity,
            message: `Node "${node.nodeId}" has no incoming or outgoing edges`,
          });
        }
      }
    }
  }

  // Rule: naming-convention
  {
    const severity = resolveRuleSeverity('naming-convention', config, strict);
    if (severity !== 'off') {
      for (const node of nodes) {
        const id = node.nodeId;
        const tooShort = id.length < NAMING_CONVENTION_MIN_LENGTH;
        const badPattern = !NAMING_CONVENTION_RE.test(id);
        if (tooShort) {
          findings.push({
            ruleId: 'naming-convention',
            severity,
            message: `nodeId "${id}" is too short — use descriptive names (min ${NAMING_CONVENTION_MIN_LENGTH} chars)`,
          });
        } else if (badPattern) {
          findings.push({
            ruleId: 'naming-convention',
            severity,
            message: `nodeId "${id}" does not match /^[a-z][a-z0-9-]*$/ — use lowercase letters, digits, and hyphens`,
          });
        }
      }
    }
  }

  // Rule: max-cost-per-run
  {
    const severity = resolveRuleSeverity('max-cost-per-run', config, strict);
    if (severity !== 'off') {
      const maxCost = getRuleThreshold('max-cost-per-run', config, DEFAULT_MAX_COST_USD);
      const estimatedCost = estimateRunCostUsd(dag);
      if (estimatedCost > maxCost) {
        findings.push({
          ruleId: 'max-cost-per-run',
          severity,
          message: `Estimated run cost $${estimatedCost.toFixed(2)} exceeds limit $${maxCost.toFixed(2)}`,
        });
      }
    }
  }

  // Rule: max-nodes
  {
    const severity = resolveRuleSeverity('max-nodes', config, strict);
    if (severity !== 'off') {
      const maxNodes = getRuleThreshold('max-nodes', config, DEFAULT_MAX_NODES);
      if (nodes.length > maxNodes) {
        findings.push({
          ruleId: 'max-nodes',
          severity,
          message: `Workflow has ${nodes.length} nodes, exceeds limit of ${maxNodes}`,
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

async function collectDagFiles(target: string): Promise<string[]> {
  let isDirectory = false;
  try {
    const s = await stat(target);
    isDirectory = s.isDirectory();
  } catch {
    // allow-fallback: unreadable path produces empty file list, caller reports no files found
    return [];
  }

  if (isDirectory) {
    let entries: string[];
    try {
      entries = await readdir(target);
    } catch {
      // allow-fallback: unreadable directory produces empty file list
      return [];
    }
    return entries.filter((f) => f.endsWith('.dag.json')).map((f) => join(target, f));
  }

  return [target];
}

// ---------------------------------------------------------------------------
// Lint a single file
// ---------------------------------------------------------------------------

async function lintFile(
  filePath: string,
  config: ILintConfig,
  strict: boolean,
): Promise<IFileLintResult> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    // allow-fallback: unreadable file is reported as a parse error finding
    return {
      file: filePath,
      findings: [],
      parseError: `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let dag: unknown;
  try {
    dag = JSON.parse(text) as unknown;
  } catch (err) {
    // allow-fallback: invalid JSON is reported as a parse error finding
    return {
      file: filePath,
      findings: [],
      parseError: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof dag !== 'object' || dag === null || Array.isArray(dag)) {
    return {
      file: filePath,
      findings: [],
      parseError: 'File must contain a JSON object.',
    };
  }

  const findings = lintDag(dag as IDagDefinition, config, strict);
  return { file: filePath, findings, parseError: null };
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

function severityLabel(s: TRuleSeverity): string {
  return s === 'error' ? 'ERROR' : 'WARN ';
}

function renderPretty(results: IFileLintResult[], io: IDagCliIo): void {
  const totalFiles = results.length;
  const totalErrors = results.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.severity === 'error').length,
    0,
  );
  const totalWarnings = results.reduce(
    (sum, r) => sum + r.findings.filter((f) => f.severity === 'warn').length,
    0,
  );
  const parseErrors = results.filter((r) => r.parseError !== null).length;

  io.write(`Linting ${totalFiles} workflow file${totalFiles === 1 ? '' : 's'}...\n\n`);

  for (const result of results) {
    const label = basename(result.file);
    if (result.parseError !== null) {
      io.write(`${label}\n`);
      io.write(`  ERROR  ${result.parseError} (parse-error)\n`);
      io.write('\n');
      continue;
    }
    if (result.findings.length === 0) {
      io.write(`${label} ✓\n`);
      continue;
    }
    io.write(`${label}\n`);
    for (const finding of result.findings) {
      io.write(`  ${severityLabel(finding.severity)}  ${finding.message} (${finding.ruleId})\n`);
    }
    io.write('\n');
  }

  const parts: string[] = [`${totalFiles} file${totalFiles === 1 ? '' : 's'}`];
  if (parseErrors > 0) parts.push(`${parseErrors} parse error${parseErrors === 1 ? '' : 's'}`);
  if (totalErrors > 0) parts.push(`${totalErrors} error${totalErrors === 1 ? '' : 's'}`);
  if (totalWarnings > 0) parts.push(`${totalWarnings} warning${totalWarnings === 1 ? '' : 's'}`);
  if (parseErrors === 0 && totalErrors === 0 && totalWarnings === 0) parts.push('no issues found');
  io.write(parts.join(', ') + '\n');
}

function renderJson(results: IFileLintResult[], io: IDagCliIo): void {
  const output = results.map((r) => ({
    file: r.file,
    parseError: r.parseError,
    findings: r.findings,
  }));
  io.write(`${JSON.stringify(output, null, JSON_INDENT_SPACES)}\n`);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Execute the `dag lint <file|directory>` subcommand.
 *
 * @param args - The argv slice starting after the `lint` keyword.
 * @param options - IO abstraction and optional working directory.
 * @returns Exit code (0 = clean, 1 = errors, 2 = config error).
 */
export async function lintCommand(
  args: readonly string[],
  options: ILintCommandOptions,
): Promise<number> {
  const { io, cwd = process.cwd() } = options;

  const parseResult = parseLintArgv(args);
  if (!parseResult.ok) {
    io.write(
      parseResult.exitCode === SUCCESS_EXIT_CODE
        ? parseResult.message
        : `Error: ${parseResult.message}\n`,
    );
    return parseResult.exitCode;
  }

  const { targets, strict, outputFormat, showHook, rulesUrl, rulesPkg } = parseResult.value;

  // --show-hook: print pre-commit snippet and exit
  if (showHook) {
    io.write(PRE_COMMIT_SNIPPET);
    return SUCCESS_EXIT_CODE;
  }

  // Load lint config
  const configResult = await loadLintConfig(cwd);
  if (!configResult.ok) {
    io.write(`Error: ${configResult.message}\n`);
    return CONFIG_EXIT_CODE;
  }
  let lintConfig = configResult.config;

  // Process extends packages from lint.json (local rules take precedence over extended)
  if (lintConfig.extends !== undefined && lintConfig.extends.length > 0) {
    let extendedRules: ILintConfig['rules'] = {};
    for (const pkg of lintConfig.extends) {
      const pkgRules = loadPkgRules(pkg, io);
      if (pkgRules !== null) {
        extendedRules = { ...extendedRules, ...pkgRules };
      }
    }
    lintConfig = { extends: lintConfig.extends, rules: { ...extendedRules, ...lintConfig.rules } };
  }

  // Merge package rules if --rules-pkg provided (local takes precedence)
  if (rulesPkg !== undefined) {
    const pkgRules = loadPkgRules(rulesPkg, io);
    if (pkgRules !== null) {
      lintConfig = { extends: lintConfig.extends, rules: { ...pkgRules, ...lintConfig.rules } };
    }
  }

  // Merge remote rules if --rules-url provided (local takes precedence)
  if (rulesUrl !== undefined) {
    const remoteRules = await fetchRemoteRules(rulesUrl, io);
    if (remoteRules !== null) {
      lintConfig = { rules: { ...remoteRules, ...lintConfig.rules } };
    }
  }

  // Collect all files to lint
  const resolvedTargets = targets.map((t) => resolve(cwd, t));
  const fileListsPromises = resolvedTargets.map((t) => collectDagFiles(t));
  const fileLists = await Promise.all(fileListsPromises);
  const allFiles = fileLists.flat();

  if (allFiles.length === 0) {
    io.write('No .dag.json files found to lint.\n');
    return SUCCESS_EXIT_CODE;
  }

  // Lint all files
  const resultsPromises = allFiles.map((f) => lintFile(f, lintConfig, strict));
  const results = await Promise.all(resultsPromises);

  // Render output
  if (outputFormat === OUTPUT_FORMAT_JSON) {
    renderJson(results, io);
  } else {
    renderPretty(results, io);
  }

  // Determine exit code
  const hasParseErrors = results.some((r) => r.parseError !== null);
  const hasErrors = results.some((r) => r.findings.some((f) => f.severity === 'error'));
  return hasParseErrors || hasErrors ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE;
}
