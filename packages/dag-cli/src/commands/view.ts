import type { IDagDefinition } from '@robota-sdk/dag-core';
import { isWorkflowFileFormat, fromDagWorkflowFile } from '@robota-sdk/dag-builder';
import type { IDagCliIo } from '../types.js';
import { USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import { parseDagMd, DAG_MD_SUFFIX } from '../dag-md-parser/parse-dag-md.js';
import { buildFlowLayout, renderFlowLayout } from '../renderer/flow-lines.js';

const VIEW_HELP_TEXT = `Usage: dag view <file> [options]

Display a DAG workflow file as an ASCII flow diagram.

Arguments:
  <file>             Path to a .dag.json, .dag.robota.json, or .dag.md file

Options:
  --mermaid          Output Mermaid flowchart syntax instead of ASCII
  --ascii            Force ASCII output (default)
  --help             Show this help message

Examples:
  dag view workflow.dag.json
  dag view workflow.dag.json --mermaid
`;

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type TReadDagFileResult =
  | { readonly ok: true; readonly value: IDagDefinition }
  | { readonly ok: false; readonly message: string; readonly exitCode: number };

async function readDagFile(filePath: string, io: IDagCliIo): Promise<TReadDagFileResult> {
  let text: string;
  try {
    text = await io.readTextFile(filePath);
  } catch (readErr) {
    // allow-fallback: I/O error is converted to a structured error result and returned
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Failed to read file "${filePath}": ${resolveErrorMessage(readErr)}`,
    };
  }

  if (filePath.endsWith(DAG_MD_SUFFIX)) {
    const mdResult = parseDagMd(text);
    if (!mdResult.ok) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `Failed to parse "${filePath}": ${mdResult.error}`,
      };
    }
    return { ok: true, value: mdResult.definition };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (parseErr) {
    // allow-fallback: JSON parse error is converted to a structured error result and returned
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `Failed to parse JSON from "${filePath}": ${resolveErrorMessage(parseErr)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `DAG file "${filePath}" must contain a JSON object.`,
    };
  }

  if (isWorkflowFileFormat(parsed)) {
    const companionPath = filePath.replace(/\.dag\.json$/, '.dag.robota.json');
    let companion: import('@robota-sdk/dag-core').IDagRobotaCompanion | undefined;
    if (companionPath !== filePath) {
      try {
        const companionText = await io.readTextFile(companionPath);
        companion = JSON.parse(companionText) as import('@robota-sdk/dag-core').IDagRobotaCompanion;
      } catch (_err) {
        // allow-fallback: companion file is optional
        companion = undefined;
      }
    }
    return { ok: true, value: fromDagWorkflowFile(parsed, companion) };
  }

  return { ok: true, value: parsed as IDagDefinition };
}

function buildMermaidFromEdges(dag: IDagDefinition): string {
  const lines = ['flowchart LR'];
  for (const edge of dag.edges) {
    lines.push(`  ${edge.from} --> ${edge.to}`);
  }
  return lines.join('\n');
}

type TParseViewResult =
  | { readonly ok: true; readonly file: string; readonly mermaid: boolean }
  | {
      readonly ok: false;
      readonly exitCode: number;
      readonly message: string;
      readonly isHelp?: boolean;
    };

function parseViewArgv(args: readonly string[]): TParseViewResult {
  const mutableArgs = [...args];

  // --help flag
  const helpIndex = mutableArgs.indexOf('--help');
  if (helpIndex !== -1 || mutableArgs.indexOf('-h') !== -1) {
    return {
      ok: false,
      exitCode: SUCCESS_EXIT_CODE,
      message: VIEW_HELP_TEXT,
      isHelp: true,
    };
  }

  // --mermaid flag
  const mermaidIndex = mutableArgs.indexOf('--mermaid');
  const mermaid = mermaidIndex !== -1;
  if (mermaid) mutableArgs.splice(mermaidIndex, 1);

  // --ascii flag (default, just consume it)
  const asciiIndex = mutableArgs.indexOf('--ascii');
  if (asciiIndex !== -1) mutableArgs.splice(asciiIndex, 1);

  const unknownFlags = mutableArgs.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `view received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  const positional = mutableArgs.filter((a) => !a.startsWith('--'));
  const file = positional[0];
  if (!file) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message:
        'view requires <file> argument (e.g. dag view workflow.dag.json).\n\n' + VIEW_HELP_TEXT,
    };
  }
  if (positional.length > 1) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `view received unexpected positional arguments: ${positional.slice(1).join(' ')}.`,
    };
  }

  return { ok: true, file, mermaid };
}

/**
 * Execute the `dag view <file>` command.
 *
 * Reads a DAG file and displays it as an ASCII flow diagram or Mermaid flowchart.
 */
export async function viewCommand(
  args: readonly string[],
  options: { io: IDagCliIo },
): Promise<number> {
  const { io } = options;

  const parseResult = parseViewArgv(args);
  if (!parseResult.ok) {
    if (parseResult.isHelp === true) {
      io.write(parseResult.message);
      return parseResult.exitCode;
    }
    io.writeError(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { file, mermaid } = parseResult;

  const dagFileResult = await readDagFile(file, io);
  if (!dagFileResult.ok) {
    io.writeError(`Error: ${dagFileResult.message}\n`);
    return dagFileResult.exitCode;
  }

  const dag = dagFileResult.value;

  if (mermaid) {
    io.write(buildMermaidFromEdges(dag) + '\n');
    return SUCCESS_EXIT_CODE;
  }

  // ASCII flow diagram
  const layout = buildFlowLayout(dag);
  const lines = renderFlowLayout(layout, new Map());
  for (const line of lines) {
    io.write(line + '\n');
  }

  return SUCCESS_EXIT_CODE;
}
