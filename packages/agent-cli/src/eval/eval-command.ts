/**
 * `robota eval <definition>` — the evals-as-code CI gate (SELFHOST-011 P2).
 *
 * Thin CLI wiring around the neutral `@robota-sdk/agent-framework` eval runner (`runEval`): it loads the
 * consumer's eval definition module, builds the default `runFn` from the CLI-resolved provider
 * (`createProviderFromSettings` → `createAgentRuntime` → `createSessionRunFn`), runs every case, prints a
 * compact report, and returns an EXIT CODE — `0` when the aggregate meets the threshold, `1` otherwise (the
 * CI gate). All scoring/aggregation lives in the framework; agent-cli stays a thin shell.
 *
 * The definition is a JS/ESM module (`.mjs`/`.js`) whose default (or `evalDefinition`) export is an
 * `IEvalDefinition` (`{ cases, metrics, threshold }`); metrics are consumer-supplied functions. A `.ts`
 * definition must be pre-compiled or run through the SDK (`runEval`) directly (see the `agent-eval` example).
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createAgentRuntime,
  createProviderFromSettings,
  createSessionRunFn,
  defineEval,
  runEval,
} from '@robota-sdk/agent-framework';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';

import type {
  IEvalCaseResult,
  IEvalDefinition,
  IEvalReport,
  TEvalRunFn,
} from '@robota-sdk/agent-framework';

/** Injection seams so the exit-code contract test can run without a live provider (TC-03). */
export interface IRunEvalDeps {
  /** Override the run source (default: built from the CLI-resolved provider). */
  runFn?: TEvalRunFn;
  /** Override definition loading (default: dynamic `import()` of the module path). */
  loadDefinition?: (absPath: string) => Promise<IEvalDefinition>;
}

interface IEvalCommandArgs {
  definitionPath: string | undefined;
  threshold: number | undefined;
  /** `--threshold` was supplied with a missing/non-numeric value — a CI gate must not silently ignore it. */
  thresholdInvalid: boolean;
}

/** The default/`evalDefinition` export shape of a consumer's eval-definition module. */
interface IEvalDefinitionModule {
  default?: IEvalDefinition;
  evalDefinition?: IEvalDefinition;
}

function parseEvalArgs(argv: string[]): IEvalCommandArgs {
  let definitionPath: string | undefined;
  let threshold: number | undefined;
  let thresholdInvalid = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--threshold') {
      const raw = argv[i + 1];
      const parsed = raw !== undefined ? Number.parseFloat(raw) : Number.NaN;
      if (Number.isFinite(parsed)) {
        threshold = parsed;
      } else {
        // A supplied-but-malformed override must fail loudly — silently reverting to the definition's own
        // threshold would gate CI on the wrong bar (a possible false PASS).
        thresholdInvalid = true;
      }
      i++;
    } else if (arg && !arg.startsWith('-') && definitionPath === undefined) {
      definitionPath = arg;
    }
  }
  return { definitionPath, threshold, thresholdInvalid };
}

async function loadEvalDefinition(absPath: string): Promise<IEvalDefinition> {
  // eslint-disable-next-line no-restricted-syntax -- consumer-supplied definition path, unknown at compile time (mirrors dag-cli local-node-loader)
  const mod = (await import(pathToFileURL(absPath).href)) as IEvalDefinitionModule;
  const candidate = mod.default ?? mod.evalDefinition;
  if (!candidate) {
    throw new Error(
      `eval definition module '${absPath}' has no default (or 'evalDefinition') export`,
    );
  }
  return candidate;
}

/** Build the default `runFn` from the CLI-resolved provider (a live agent run per case). */
function buildDefaultRunFn(cwd: string): TEvalRunFn {
  const provider = createProviderFromSettings(cwd, undefined, {
    providerDefinitions: createDefaultProviderDefinitions(),
  });
  const runtime = createAgentRuntime({ cwd, provider });
  return createSessionRunFn(runtime);
}

function formatScore(score: number | boolean): string {
  if (typeof score === 'boolean') {
    return score ? 'pass' : 'fail';
  }
  return score.toFixed(2);
}

/** Case-input display width in the report; longer inputs are elided with an ellipsis. */
const INPUT_DISPLAY_WIDTH = 60;
const ELLIPSIS = '...';

function formatCase(result: IEvalCaseResult, index: number): string {
  const perMetric = result.scores.map((s) => `${s.metric}=${formatScore(s.score)}`).join(', ');
  const input =
    result.input.length > INPUT_DISPLAY_WIDTH
      ? `${result.input.slice(0, INPUT_DISPLAY_WIDTH - ELLIPSIS.length)}${ELLIPSIS}`
      : result.input;
  return `  case ${index + 1} [${result.caseScore.toFixed(2)}] ${input} — ${perMetric}`;
}

/** A compact human/CI-readable report (thin-shell presentation; a neutral SDK formatter is a P3 candidate). */
function formatEvalReport(report: IEvalReport): string {
  const lines = [report.name ? `Eval: ${report.name}` : 'Eval'];
  report.results.forEach((result, index) => lines.push(formatCase(result, index)));
  lines.push(
    `Overall ${report.overallScore.toFixed(2)} vs threshold ${report.threshold.toFixed(2)} → ${
      report.passed ? 'PASS' : 'FAIL'
    }`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Load a definition, run it, print the report, and return the CI exit code (`0` pass / `1` fail). A missing
 * path, an unloadable/invalid definition, or a run error each return `1` — a broken eval IS a gate failure.
 */
export async function runEvalCommand(
  argv: string[],
  cwd: string = process.cwd(),
  deps: IRunEvalDeps = {},
): Promise<number> {
  const args = parseEvalArgs(argv);
  if (!args.definitionPath || args.thresholdInvalid) {
    process.stderr.write('Usage: robota eval <definition-file> [--threshold <0..1>]\n');
    return 1;
  }

  const absPath = path.resolve(cwd, args.definitionPath);
  let definition: IEvalDefinition;
  try {
    const loaded = await (deps.loadDefinition ?? loadEvalDefinition)(absPath);
    definition = args.threshold !== undefined ? { ...loaded, threshold: args.threshold } : loaded;
    defineEval(definition); // validate early — throws on an empty/invalid definition
  } catch (error) {
    // allow-fallback: an unloadable/invalid eval definition is a terminal gate failure (exit 1), surfaced on stderr
    process.stderr.write(
      `Failed to load eval definition: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }

  let report: IEvalReport;
  try {
    // Build the runFn inside the try so a provider-config error (no provider configured — a common CI case)
    // honors this function's number-return contract instead of rejecting.
    const runFn = deps.runFn ?? buildDefaultRunFn(cwd);
    report = await runEval(definition, runFn);
  } catch (error) {
    // allow-fallback: a failed agent run / unconfigured provider is a terminal gate failure (exit 1), on stderr
    process.stderr.write(
      `Eval run failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }

  process.stdout.write(formatEvalReport(report));
  return report.passed ? 0 : 1;
}
