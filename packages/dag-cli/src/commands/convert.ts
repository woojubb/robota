import { readFile } from 'node:fs/promises';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';

/** Simplified spec format consumed by `dag build`. */
export interface IBuildSpec {
  readonly nodes: ReadonlyArray<{
    readonly type: string;
    readonly id?: string;
    readonly config?: Record<string, unknown>;
  }>;
  readonly edges: readonly string[];
}

export interface IConvertCommandOptions {
  readonly io: IDagCliIo;
}

type TParseResult =
  | { readonly ok: true; readonly from: string; readonly input: string | undefined }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function parseConvertArgv(args: readonly string[]): TParseResult {
  const rest = [...args];
  let from: string | undefined;
  let input: string | undefined;

  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];
    if (arg === '--from') {
      const next = rest[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--from requires a value.' };
      }
      from = next;
      i += 2;
    } else if (arg === '--input') {
      const next = rest[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: '--input requires a value.' };
      }
      input = next;
      i += 2;
    } else if ((arg as string | undefined)?.startsWith('--')) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `convert received unexpected flag: ${arg}.`,
      };
    } else {
      i += 1;
    }
  }

  if (!from) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--from is required (linear or mermaid).',
    };
  }

  if (from !== 'linear' && from !== 'mermaid') {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `--from must be "linear" or "mermaid", got "${from}".`,
    };
  }

  return { ok: true, from, input };
}

/**
 * Convert a linear comma-separated node type list into an IBuildSpec.
 * Example: "input,llm-text,text-output"
 */
function convertLinear(input: string): IBuildSpec {
  const types = input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const nodes = types.map((type) => ({ type }));

  const edges: string[] = [];
  for (let i = 0; i < types.length - 1; i++) {
    edges.push(`${types[i]}→${types[i + 1]}`);
  }

  return { nodes, edges };
}

/**
 * Parse a Mermaid `graph LR` / `graph TD` diagram into an IBuildSpec.
 *
 * Supported syntax:
 *   graph LR
 *     A[nodeType] --> B[nodeType]
 *     A --> B             (no label)
 *     A -->|label| B      (label ignored)
 */
export function convertMermaid(input: string): IBuildSpec {
  const lines = input.split('\n').map((l) => l.trim());

  // Map from mermaid node id → { id, type }
  const nodeMap = new Map<string, { id: string; type: string }>();
  // Ordered insertion to preserve position
  const nodeOrder: string[] = [];
  const edges: string[] = [];

  // Regex for node declarations inside edges: A[label] or just A
  const NODE_WITH_LABEL = /^([A-Za-z0-9_-]+)\[([^\]]+)\]$/;
  const NODE_NO_LABEL = /^([A-Za-z0-9_-]+)$/;

  function registerNode(raw: string): string {
    const withLabel = NODE_WITH_LABEL.exec(raw);
    if (withLabel) {
      const mermaidId = withLabel[1];
      const label = withLabel[2];
      if (!nodeMap.has(mermaidId)) {
        // label is used as nodeType; mermaidId is used as DAG node id
        nodeMap.set(mermaidId, { id: mermaidId, type: label });
        nodeOrder.push(mermaidId);
      }
      return mermaidId;
    }
    const noLabel = NODE_NO_LABEL.exec(raw);
    if (noLabel) {
      const mermaidId = noLabel[1];
      if (!nodeMap.has(mermaidId)) {
        // Use mermaidId as both id and nodeType
        nodeMap.set(mermaidId, { id: mermaidId, type: mermaidId });
        nodeOrder.push(mermaidId);
      }
      return mermaidId;
    }
    return raw;
  }

  /**
   * Split a mermaid line by --> (with optional |label|) into individual node tokens.
   * Handles chained edges like: A[x] --> B[y] --> C[z]
   * Returns null if the line contains no arrow.
   */
  function splitByArrows(line: string): string[] | null {
    // Match --> or -->|...|
    const ARROW_RE = /\s*-->[|][^|]*[|]\s*|\s*-->\s*/g;
    const hasArrow = ARROW_RE.test(line);
    if (!hasArrow) return null;

    // Split by arrows (with optional pipe labels)
    const parts = line.split(/\s*-->[|][^|]*[|]\s*|\s*-->\s*/);
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
  }

  for (const line of lines) {
    // Skip graph header and blank lines
    if (!line || /^graph\s+(LR|TD|RL|BT|TB)/i.test(line) || line.startsWith('%%')) {
      continue;
    }

    // Try edge line — split by arrows to handle chained edges like A --> B --> C
    const tokens = splitByArrows(line);
    if (tokens !== null && tokens.length >= 2) {
      const nodeIds = tokens.map((token) => registerNode(token));
      for (let edgeIdx = 0; edgeIdx < nodeIds.length - 1; edgeIdx++) {
        edges.push(`${nodeIds[edgeIdx]}→${nodeIds[edgeIdx + 1]}`);
      }
      continue;
    }

    // Standalone node declaration: A[label]
    if (NODE_WITH_LABEL.test(line)) {
      registerNode(line);
    }
  }

  const nodes = nodeOrder.map((mermaidId) => {
    const entry = nodeMap.get(mermaidId);
    if (!entry) return { type: mermaidId };
    // If id === type (no explicit mermaid id), omit id field
    if (entry.id === entry.type) {
      return { type: entry.type };
    }
    return { type: entry.type, id: entry.id };
  });

  return { nodes, edges };
}

/**
 * Read text from stdin (used when --input is not provided).
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Execute the `dag convert` subcommand.
 *
 * @param args  - argv slice after the `convert` keyword.
 * @param options - IO abstraction.
 * @returns Exit code.
 */
export async function convertCommand(
  args: readonly string[],
  options: IConvertCommandOptions,
): Promise<number> {
  const { io } = options;

  const parseResult = parseConvertArgv(args);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { from } = parseResult;
  let inputText = parseResult.input;

  // If no --input value, try reading a file path positional or fall back to stdin
  if (inputText === undefined) {
    // Check for a positional file argument (no -- prefix)
    const positional = args.find((a) => !a.startsWith('--'));
    if (positional) {
      let fileContent: string;
      try {
        fileContent = await readFile(positional, 'utf8');
      } catch (readErr) {
        // allow-fallback: file read failure returns structured error and non-zero exit
        io.write(
          `Error: Could not read file "${positional}": ${readErr instanceof Error ? readErr.message : String(readErr)}\n`,
        );
        return FAILURE_EXIT_CODE;
      }
      inputText = fileContent;
    } else {
      // Read from stdin
      inputText = await readStdin();
    }
  }

  if (!inputText || inputText.trim().length === 0) {
    io.write('Error: No input provided. Use --input or pipe via stdin.\n');
    return FAILURE_EXIT_CODE;
  }

  let spec: IBuildSpec;
  if (from === 'linear') {
    spec = convertLinear(inputText);
  } else {
    spec = convertMermaid(inputText);
  }

  if (spec.nodes.length === 0) {
    io.write('Error: No nodes found in the input.\n');
    return FAILURE_EXIT_CODE;
  }

  io.write(JSON.stringify(spec) + '\n');
  return SUCCESS_EXIT_CODE;
}
