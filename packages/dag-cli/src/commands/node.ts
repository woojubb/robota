import { writeFile, unlink, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_WORKSPACE_LAYOUT } from '@robota-sdk/dag-core';
import type { INodeManifest, IExternalNodePackage, IWorkspaceLayout } from '@robota-sdk/dag-core';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import { discoverExternalNodePackages } from '../marketplace/external-node-scanner.js';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';
import {
  createCliNodeRegistry,
  loadLocalNodeDefinitions,
  loadNodeFileExplicit,
} from '../local-runner/index.js';
import { nodesDir } from '../local-runner/persistence/paths.js';
import { runCommand } from './run.js';

const OUTPUT_FORMAT_JSON = 'json';
const OUTPUT_FORMAT_TABLE = 'table';
const OUTPUT_FORMAT_PRETTY = 'pretty';
const JSON_INDENT_SPACES = 2;

export interface INodeCommandOptions {
  readonly io: IDagCliIo;
  readonly workspace?: IWorkspaceLayout;
}

type TNodeSubcommand = 'list' | 'info' | 'schema' | 'example' | 'scaffold' | 'validate';

interface ILocalScaffoldOptions {
  readonly dir: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly configs: readonly string[];
}

type TParseResult =
  | {
      readonly ok: true;
      readonly subcommand: TNodeSubcommand;
      readonly nodeType?: string;
      readonly category?: string;
      readonly outputFormat: string;
      readonly runFlag: boolean;
      readonly runInputs: readonly string[];
      readonly localScaffold?: ILocalScaffoldOptions;
      readonly jsFlag?: boolean;
      readonly dryRun?: boolean;
      readonly noLocal?: boolean;
      readonly includeExternal?: boolean;
      readonly filePath?: string;
    }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function takeSingleOption(
  args: readonly string[],
  optionName: string,
): {
  readonly value: string | undefined;
  readonly remaining: readonly string[];
  readonly error?: string;
} {
  const remaining: string[] = [];
  let value: string | undefined;
  let i = 0;
  while (i < args.length) {
    const current = args[i];
    if (current === optionName) {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        return { value: undefined, remaining, error: `${optionName} requires a value.` };
      }
      value = next;
      i += 2;
      continue;
    }
    remaining.push(current as string);
    i += 1;
  }
  return { value, remaining };
}

/**
 * Collect all values for a repeatable option like `--input key=value`.
 */
function collectStringOptions(
  args: readonly string[],
  optionName: string,
): { readonly values: readonly string[]; readonly remaining: readonly string[] } {
  const values: string[] = [];
  const remaining: string[] = [];
  let i = 0;
  while (i < args.length) {
    const current = args[i];
    if (current === optionName) {
      const next = args[i + 1];
      if (typeof next === 'string' && !next.startsWith('--')) {
        values.push(next);
        i += 2;
        continue;
      }
    }
    remaining.push(current as string);
    i += 1;
  }
  return { values, remaining };
}

function parseNodeArgv(args: readonly string[]): TParseResult {
  const subcommand = args[0];

  // AGENTUX-001: --help exits 0 with full usage
  if (subcommand === '--help') {
    return {
      ok: false,
      exitCode: SUCCESS_EXIT_CODE,
      message: [
        'Usage: dag node <subcommand>',
        '',
        'Subcommands:',
        '  list                    List all available node types (includes local custom nodes)',
        '  info <type>             Show ports and config for a node type',
        '  schema <type>           Print the JSON schema for a node type',
        '  example <type>          Generate a minimal runnable .dag.json',
        '  scaffold <name>         Create a custom local node (.dag/nodes/ manifest + companion)',
        '  validate <file>         Validate a local node file and print its manifest',
        '',
        'Examples:',
        '  dag node list',
        '  dag node info llm-text',
        '  dag node scaffold my-node',
        '  dag node validate ./my-node.dag.node.js',
        '',
        'Run: dag node <subcommand> --help  for subcommand-specific flags',
      ].join('\n'),
    };
  }

  if (
    subcommand !== 'list' &&
    subcommand !== 'info' &&
    subcommand !== 'schema' &&
    subcommand !== 'example' &&
    subcommand !== 'scaffold' &&
    subcommand !== 'validate'
  ) {
    const validSubcommands = 'list, info, schema, example, scaffold, validate';
    const detail =
      subcommand === undefined
        ? `node requires a subcommand (${validSubcommands}).\n\nExamples:\n  dag node list\n  dag node info llm-text\n  dag node scaffold my-node`
        : `Unknown node subcommand "${subcommand}". Valid subcommands: ${validSubcommands}.`;
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: detail };
  }

  const rawRest = args.slice(1);

  // --json is a shorthand for --output json
  const rest = rawRest.includes('--json')
    ? ['--output', 'json', ...rawRest.filter((a) => a !== '--json')]
    : rawRest;

  // scaffold is handled before --output parsing (no format flag needed)
  if (subcommand === 'scaffold') {
    // NODEDX-002: --help prints usage and exits cleanly
    if (rest.includes('--help')) {
      return {
        ok: false,
        exitCode: SUCCESS_EXIT_CODE,
        message: [
          'Usage: dag node scaffold <name> [flags]',
          '',
          'Generate a local code node — a .dag/nodes/<name>.node.json manifest (metadata) plus a',
          '<name>.dag.node.js companion (execute only) — or an npm-publish TypeScript scaffold.',
          '',
          'Flags (local mode, default):',
          '  --dir <path>          Project directory (writes into <dir>/.dag/nodes/; default: cwd)',
          '  --input <key:type>    Declare an input port (repeatable)',
          '  --output <key:type>   Declare an output port (repeatable)',
          '  --config <key:type>   Declare a config field (repeatable)',
          '  --dry-run             Print the generated manifest + companion to stdout without writing',
          '',
          'Flags (npm-publish mode):',
          '  --publish             Generate a TypeScript scaffold for npm package publishing',
          '  --js                  With --publish: generate JS instead of TS',
          '',
          'Examples:',
          '  dag node scaffold text-uppercase',
          '  dag node scaffold translate --input text:string --output result:string',
          '  dag node scaffold my-node --dir ./nodes/ --dry-run',
          '  dag node scaffold my-node --publish',
        ].join('\n'),
      };
    }

    // NODEDX-001: --local is now the default; --publish routes to npm-package path
    const isPublish = rest.includes('--publish');
    // --local kept for backward compat but is now the default
    const afterKnownModeFlags = rest.filter((a) => a !== '--local' && a !== '--publish');

    // --js flag (only meaningful with --publish)
    const jsFlag = afterKnownModeFlags.includes('--js');
    const afterJsFlag = afterKnownModeFlags.filter((a) => a !== '--js');

    const positionalArgs = afterJsFlag.filter((a) => !a.startsWith('--'));
    const scaffoldName = positionalArgs[0];
    if (!scaffoldName) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message:
          'node scaffold requires <name> argument.\n\nUsage: dag node scaffold <name> [--dir <path>] [--input key:type] ...\nRun: dag node scaffold --help',
      };
    }

    if (!isPublish) {
      // NODEDX-001: local mode is now the default
      const collectOpt = (flagName: string, arr: readonly string[]): string[] => {
        const vals: string[] = [];
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] === flagName && i + 1 < arr.length) {
            vals.push(arr[i + 1] as string);
            i++;
          }
        }
        return vals;
      };
      const takeSingleOpt = (flagName: string, arr: readonly string[]): string | undefined => {
        const idx = arr.indexOf(flagName);
        if (idx !== -1 && idx + 1 < arr.length) return arr[idx + 1];
        return undefined;
      };

      // NODEDX-008: --dry-run flag
      const dryRun = afterJsFlag.includes('--dry-run');
      const afterDryRun = afterJsFlag.filter((a) => a !== '--dry-run');

      const localDir = takeSingleOpt('--dir', afterDryRun) ?? process.cwd();
      const localInputs = collectOpt('--input', afterDryRun);
      const localOutputs = collectOpt('--output', afterDryRun);
      const localConfigs = collectOpt('--config', afterDryRun);

      const knownLocalFlags = new Set(['--dir', '--input', '--output', '--config']);
      const unknownFlags = afterDryRun.filter((a) => a.startsWith('--') && !knownLocalFlags.has(a));
      if (unknownFlags.length > 0) {
        return {
          ok: false,
          exitCode: USAGE_ERROR_EXIT_CODE,
          message: `node scaffold received unexpected flags: ${unknownFlags.join(' ')}.\nRun: dag node scaffold --help`,
        };
      }

      return {
        ok: true,
        subcommand: 'scaffold',
        nodeType: scaffoldName,
        outputFormat: OUTPUT_FORMAT_PRETTY,
        runFlag: false,
        runInputs: [],
        dryRun,
        localScaffold: {
          dir: localDir,
          inputs: localInputs,
          outputs: localOutputs,
          configs: localConfigs,
        },
      };
    }

    // --publish mode: generate TypeScript npm-package scaffold
    const unknownPublishFlags = afterJsFlag.filter((a) => a.startsWith('--') && a !== '--dry-run');
    if (unknownPublishFlags.length > 0) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `node scaffold --publish received unexpected flags: ${unknownPublishFlags.join(' ')}.\nRun: dag node scaffold --help`,
      };
    }
    return {
      ok: true,
      subcommand: 'scaffold',
      nodeType: scaffoldName,
      outputFormat: OUTPUT_FORMAT_PRETTY,
      runFlag: false,
      runInputs: [],
      jsFlag,
    };
  }

  // AGENTUX-005: validate is handled before --output parsing
  if (subcommand === 'validate') {
    // use rest (--json already converted to --output json)
    if (rest.includes('--help')) {
      return {
        ok: false,
        exitCode: SUCCESS_EXIT_CODE,
        message: [
          'Usage: dag node validate <file> [flags]',
          '',
          'Load a local node file, validate port schemas, and print its manifest.',
          'Exits 0 on success, non-zero if the file is invalid.',
          '',
          'Flags:',
          '  --json              Output as JSON (shorthand for --output json)',
          '  --output <fmt>      Output format: pretty (default), json',
          '',
          'Examples:',
          '  dag node validate ./my-node.dag.node.js',
          '  dag node validate ./my-node.dag.node.js --json',
        ].join('\n'),
      };
    }
    // AGENTUX-007: parse --output for JSON mode support
    const validateOutputResult = takeSingleOption(rest, '--output');
    const validateOutputFormat = validateOutputResult.value ?? OUTPUT_FORMAT_PRETTY;
    if (
      validateOutputFormat !== OUTPUT_FORMAT_PRETTY &&
      validateOutputFormat !== OUTPUT_FORMAT_JSON
    ) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `--output must be one of: pretty, json.`,
      };
    }
    const unknownValidateFlags = validateOutputResult.remaining.filter((a) => a.startsWith('--'));
    if (unknownValidateFlags.length > 0) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `node validate received unexpected flags: ${unknownValidateFlags.join(' ')}.\nRun: dag node validate --help`,
      };
    }
    const filePath = validateOutputResult.remaining.filter((a) => !a.startsWith('--'))[0];
    if (!filePath) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: 'node validate requires <file> argument.\n\nUsage: dag node validate <file>',
      };
    }
    return {
      ok: true,
      subcommand: 'validate',
      outputFormat: validateOutputFormat,
      runFlag: false,
      runInputs: [],
      filePath,
    };
  }

  // --output <format>
  const outputResult = takeSingleOption(rest, '--output');
  if (outputResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: outputResult.error };
  }

  const defaultFormat =
    subcommand === 'list'
      ? OUTPUT_FORMAT_TABLE
      : subcommand === 'schema' || subcommand === 'example'
        ? OUTPUT_FORMAT_JSON
        : OUTPUT_FORMAT_PRETTY;
  const outputFormat = outputResult.value ?? defaultFormat;

  const validFormats =
    subcommand === 'list'
      ? [OUTPUT_FORMAT_JSON, OUTPUT_FORMAT_TABLE]
      : subcommand === 'info'
        ? [OUTPUT_FORMAT_JSON, OUTPUT_FORMAT_PRETTY]
        : [OUTPUT_FORMAT_JSON];

  if (!validFormats.includes(outputFormat)) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `--output must be one of: ${validFormats.join(', ')}.`,
    };
  }

  if (subcommand === 'list') {
    // AGENTUX-006: --help exits 0
    if (outputResult.remaining.includes('--help')) {
      return {
        ok: false,
        exitCode: SUCCESS_EXIT_CODE,
        message: [
          'Usage: dag node list [flags]',
          '',
          'Flags:',
          '  --category <name>       Filter by category (case-insensitive)',
          '  --no-local              Skip CWD auto-scan of custom nodes',
          '  --include-external      Include third-party npm packages (robota-dag-node keyword)',
          '  --output <fmt>          Output format: table (default), json',
          '',
          'Examples:',
          '  dag node list',
          '  dag node list --category AI',
          '  dag node list --include-external',
          '  dag node list --no-local --output json',
          '  dag node list --include-external',
        ].join('\n'),
      };
    }
    // --category <cat>
    const categoryResult = takeSingleOption(outputResult.remaining, '--category');
    if (categoryResult.error) {
      return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: categoryResult.error };
    }
    // AGENTUX-003: --no-local skips CWD auto-scan of custom nodes
    const noLocal = categoryResult.remaining.includes('--no-local');
    const afterNoLocal = categoryResult.remaining.filter((a) => a !== '--no-local');
    const includeExternal = afterNoLocal.includes('--include-external');
    const afterIncludeExternal = afterNoLocal.filter((a) => a !== '--include-external');
    const unknownFlags = afterIncludeExternal.filter((a) => a.startsWith('--'));
    if (unknownFlags.length > 0) {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `node list received unexpected flags: ${unknownFlags.join(' ')}.`,
      };
    }
    return {
      ok: true,
      subcommand: 'list',
      category: categoryResult.value,
      outputFormat,
      runFlag: false,
      runInputs: [],
      noLocal,
      includeExternal,
    };
  }

  // AGENTUX-006: --help for info, schema, example
  if (outputResult.remaining.includes('--help')) {
    if (subcommand === 'info') {
      return {
        ok: false,
        exitCode: SUCCESS_EXIT_CODE,
        message: [
          'Usage: dag node info <type> [flags]',
          '',
          'Flags:',
          '  --node-file <path>  Load node from an explicit file path',
          '  --no-local          Skip CWD auto-scan of custom nodes',
          '  --output <fmt>      Output format: pretty (default), json',
          '',
          'Examples:',
          '  dag node info llm-text',
          '  dag node info my-node --node-file ./my-node.dag.node.js',
          '  dag node info my-node --output json',
        ].join('\n'),
      };
    }
    if (subcommand === 'schema') {
      return {
        ok: false,
        exitCode: SUCCESS_EXIT_CODE,
        message: [
          'Usage: dag node schema <type>',
          '',
          'Print the JSON config schema for a node type.',
          '',
          'Examples:',
          '  dag node schema llm-text',
        ].join('\n'),
      };
    }
    // example
    return {
      ok: false,
      exitCode: SUCCESS_EXIT_CODE,
      message: [
        'Usage: dag node example <type> [flags]',
        '',
        'Generate a minimal runnable .dag.json for the specified node type.',
        '',
        'Flags:',
        '  --run               Execute the example immediately after generating',
        '  --input key=value   Input values for --run (repeatable)',
        '  --output <fmt>      Output format: json (only option)',
        '',
        'Examples:',
        '  dag node example llm-text',
        '  dag node example transform --run --input text="hello"',
      ].join('\n'),
    };
  }

  // --run flag (example only)
  const runFlagIndex = outputResult.remaining.indexOf('--run');
  const runFlag = runFlagIndex !== -1;
  const afterRunFlag = runFlag
    ? [
        ...outputResult.remaining.slice(0, runFlagIndex),
        ...outputResult.remaining.slice(runFlagIndex + 1),
      ]
    : [...outputResult.remaining];

  // --input key=value (repeatable, used with --run)
  const inputResult = collectStringOptions(afterRunFlag, '--input');

  // AGENTUX-003: --no-local skips CWD auto-scan for info command
  const noLocal = subcommand === 'info' && inputResult.remaining.includes('--no-local');
  const remainingAfterNoLocal = noLocal
    ? inputResult.remaining.filter((a) => a !== '--no-local')
    : inputResult.remaining;

  // AGENTUX-008: --node-file for info subcommand (explicit path override)
  const nodeFileResult =
    subcommand === 'info'
      ? takeSingleOption(remainingAfterNoLocal, '--node-file')
      : { value: undefined, remaining: remainingAfterNoLocal };
  const remainingAfterNodeFile = nodeFileResult.remaining;

  // info, schema, example require <nodeType>
  const positional = remainingAfterNodeFile.filter((a) => !a.startsWith('--'));
  const unknownFlags = remainingAfterNodeFile.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `node ${subcommand} received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  const nodeType = positional[0];
  // AGENTUX-008: nodeType is optional when --node-file is provided (inferred from file)
  if (!nodeType && nodeFileResult.value === undefined) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `node ${subcommand} requires <nodeType> argument.`,
    };
  }

  if (runFlag && subcommand !== 'example') {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: '--run can only be used with "node example".',
    };
  }

  return {
    ok: true,
    subcommand,
    nodeType,
    outputFormat,
    runFlag,
    runInputs: inputResult.values,
    noLocal,
    filePath: nodeFileResult.value,
  };
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function groupByCategory(manifests: INodeManifest[]): Map<string, INodeManifest[]> {
  const map = new Map<string, INodeManifest[]>();
  for (const manifest of manifests) {
    const list = map.get(manifest.category);
    if (list !== undefined) {
      list.push(manifest);
    } else {
      map.set(manifest.category, [manifest]);
    }
  }
  return map;
}

/**
 * Find node types whose names include the query string (case-insensitive).
 */
function findSimilarTypes(allTypes: string[], query: string): string[] {
  const lower = query.toLowerCase();
  return allTypes.filter((t) => t.includes(lower));
}

function handleListCommand(
  manifests: INodeManifest[],
  category: string | undefined,
  outputFormat: string,
  io: IDagCliIo,
  externalPkgs: IExternalNodePackage[] = [],
): number {
  const filtered =
    category !== undefined
      ? manifests.filter((m) => m.category.toLowerCase() === category.toLowerCase())
      : manifests;

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    const nodes = filtered.map((m) => ({
      nodeType: m.nodeType,
      displayName: m.displayName,
      category: m.category,
      defaultInputPort: m.defaultInputPort ?? null,
      defaultOutputPort: m.defaultOutputPort ?? null,
    }));
    const externalPackages = externalPkgs.map((p) => ({
      name: p.name,
      version: p.version,
      nodes: p.nodeManifest.nodes.map((n) => ({
        nodeType: n.nodeType,
        displayName: n.displayName,
        category: n.category,
      })),
    }));
    io.write(`${JSON.stringify({ nodes, externalPackages }, null, JSON_INDENT_SPACES)}\n`);
    return SUCCESS_EXIT_CODE;
  }

  // Table / pretty output
  if (filtered.length === 0 && externalPkgs.length === 0) {
    io.write(
      category !== undefined
        ? `No nodes found in category "${category}".\n`
        : 'No nodes registered.\n',
    );
    return SUCCESS_EXIT_CODE;
  }

  if (filtered.length > 0) {
    const byCategory = groupByCategory(filtered);
    for (const [cat, nodes] of byCategory.entries()) {
      io.write(`\n[${cat}]\n`);
      for (const node of nodes) {
        io.write(`  ${node.nodeType.padEnd(36)} ${node.displayName}\n`);
      }
    }
  }

  for (const pkg of externalPkgs) {
    io.write(`\n[External — ${pkg.name}@${pkg.version}]\n`);
    for (const node of pkg.nodeManifest.nodes) {
      io.write(`  ${node.nodeType.padEnd(36)} ${node.displayName}\n`);
    }
  }

  io.write('\n');
  io.write(`Tip: dag node example <type>  →  see a minimal runnable .dag.json\n`);
  io.write(`     dag node info <type>     →  see ports and config keys\n`);
  return SUCCESS_EXIT_CODE;
}

function buildCompatibleConnections(
  manifest: INodeManifest,
  allManifests: INodeManifest[],
): string[] {
  const lines: string[] = [];
  const MAX_PER_OUTPUT = 3;
  const MAX_TOTAL = 5;

  for (const outPort of manifest.outputs) {
    let countForPort = 0;
    for (const other of allManifests) {
      if (other.nodeType === manifest.nodeType) continue;
      for (const inPort of other.inputs) {
        if (inPort.type === outPort.type) {
          lines.push(
            `  ${outPort.key}(${outPort.type}) → ${other.nodeType}.${inPort.key}(${inPort.type})`,
          );
          countForPort += 1;
          if (countForPort >= MAX_PER_OUTPUT) break;
        }
      }
      if (lines.length >= MAX_TOTAL) break;
    }
    if (lines.length >= MAX_TOTAL) break;
  }

  return lines;
}

function handleInfoCommand(
  manifests: INodeManifest[],
  nodeType: string,
  outputFormat: string,
  io: IDagCliIo,
): number {
  const manifest = manifests.find((m) => m.nodeType === nodeType);
  if (manifest === undefined) {
    const allTypes = manifests.map((m) => m.nodeType);
    const similar = findSimilarTypes(allTypes, nodeType);
    if (outputFormat === OUTPUT_FORMAT_JSON) {
      const suggestion = similar.length > 0 ? similar : undefined;
      io.write(
        `${JSON.stringify(
          {
            error: `Unknown node type "${nodeType}"`,
            ...(suggestion !== undefined ? { suggestions: suggestion } : {}),
          },
          null,
          JSON_INDENT_SPACES,
        )}\n`,
      );
    } else {
      io.write(`Error: Unknown node type "${nodeType}"\n`);
      if (similar.length > 0) {
        io.write(`  Did you mean: ${similar.join(', ')}?\n`);
      }
    }
    return USAGE_ERROR_EXIT_CODE;
  }

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    const shaped = {
      nodeType: manifest.nodeType,
      displayName: manifest.displayName,
      category: manifest.category,
      defaultInputPort: manifest.defaultInputPort ?? null,
      defaultOutputPort: manifest.defaultOutputPort ?? null,
      inputs: manifest.inputs.map((p) => ({ portKey: p.key, type: p.type, required: p.required })),
      outputs: manifest.outputs.map((p) => ({
        portKey: p.key,
        type: p.type,
        required: p.required,
      })),
      configSchema: manifest.configSchema ?? null,
    };
    io.write(`${JSON.stringify(shaped, null, JSON_INDENT_SPACES)}\n`);
    return SUCCESS_EXIT_CODE;
  }

  // Pretty output
  io.write(`Node: ${manifest.nodeType}\n`);
  io.write(`  displayName:      ${manifest.displayName}\n`);
  io.write(`  category:         ${manifest.category}\n`);
  if (manifest.defaultInputPort !== undefined) {
    io.write(`  defaultInputPort: ${manifest.defaultInputPort}\n`);
  }
  if (manifest.defaultOutputPort !== undefined) {
    io.write(`  defaultOutputPort: ${manifest.defaultOutputPort}\n`);
  }
  io.write(`\n  Inputs (${manifest.inputs.length}):\n`);
  for (const port of manifest.inputs) {
    const req = port.required ? 'required' : 'optional';
    io.write(`    ${port.key.padEnd(20)} type=${port.type}  ${req}\n`);
  }
  io.write(`\n  Outputs (${manifest.outputs.length}):\n`);
  for (const port of manifest.outputs) {
    const req = port.required ? 'required' : 'optional';
    io.write(`    ${port.key.padEnd(20)} type=${port.type}  ${req}\n`);
  }
  if (manifest.configSchema !== undefined) {
    const props = manifest.configSchema['properties'];
    if (props !== null && typeof props === 'object') {
      io.write(`\n  Config keys:\n`);
      for (const [key, schema] of Object.entries(
        props as Record<string, Record<string, unknown>>,
      )) {
        const type = typeof schema['type'] === 'string' ? schema['type'] : 'unknown';
        const def =
          schema['default'] !== undefined ? ` (default: ${JSON.stringify(schema['default'])})` : '';
        io.write(`    ${key.padEnd(20)} type=${type}${def}\n`);
      }
    }
  }

  const compatibleLines = buildCompatibleConnections(manifest, manifests);
  if (compatibleLines.length > 0) {
    io.write(`\n  Compatible connections (same port type):\n`);
    for (const line of compatibleLines) {
      io.write(`${line}\n`);
    }
  }

  return SUCCESS_EXIT_CODE;
}

function handleSchemaCommand(
  manifests: INodeManifest[],
  nodeType: string,
  outputFormat: string,
  io: IDagCliIo,
): number {
  const manifest = manifests.find((m) => m.nodeType === nodeType);
  if (manifest === undefined) {
    const allTypes = manifests.map((m) => m.nodeType);
    const similar = findSimilarTypes(allTypes, nodeType);
    io.write(
      `${JSON.stringify(
        {
          error: `Unknown node type "${nodeType}"`,
          ...(similar.length > 0 ? { suggestions: similar } : {}),
        },
        null,
        JSON_INDENT_SPACES,
      )}\n`,
    );
    return USAGE_ERROR_EXIT_CODE;
  }

  // configSchema is a JSON Schema object (built by zod-to-json-schema) stored on the manifest
  const schema = manifest.configSchema ?? {};
  io.write(
    `${JSON.stringify({ nodeType: manifest.nodeType, configSchema: schema }, null, JSON_INDENT_SPACES)}\n`,
  );
  return SUCCESS_EXIT_CODE;
}

const DEFAULT_CONFIGS: Record<string, Record<string, string>> = {
  'llm-text': { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
};

function handleExampleCommand(manifests: INodeManifest[], nodeType: string, io: IDagCliIo): number {
  const manifest = manifests.find((m) => m.nodeType === nodeType);
  if (manifest === undefined) {
    const allTypes = manifests.map((m) => m.nodeType);
    const similar = findSimilarTypes(allTypes, nodeType);
    io.write(
      `${JSON.stringify(
        {
          error: `Unknown node type "${nodeType}"`,
          ...(similar.length > 0 ? { suggestions: similar } : {}),
        },
        null,
        JSON_INDENT_SPACES,
      )}\n`,
    );
    return USAGE_ERROR_EXIT_CODE;
  }

  const config: Record<string, string> = DEFAULT_CONFIGS[nodeType] ?? {};

  const hasInputs = manifest.inputs.length > 0;
  const hasOutputs = manifest.outputs.length > 0;

  const firstInputPort = manifest.inputs.find((p) => p.required)?.key ?? manifest.inputs[0]?.key;
  const firstOutputPort = manifest.outputs.find((p) => p.required)?.key ?? manifest.outputs[0]?.key;

  const nodes: object[] = [];
  const edges: object[] = [];

  if (hasInputs) {
    nodes.push({
      nodeId: 'input',
      nodeType: 'input',
      dependsOn: [],
      config: {},
      position: { x: 100, y: 200 },
    });
  }

  nodes.push({
    nodeId: 'target',
    nodeType,
    dependsOn: hasInputs ? ['input'] : [],
    config,
    position: { x: 400, y: 200 },
  });

  if (hasOutputs) {
    nodes.push({
      nodeId: 'output',
      nodeType: 'text-output',
      dependsOn: ['target'],
      config: {},
      position: { x: 700, y: 200 },
    });
  }

  if (hasInputs && firstInputPort !== undefined) {
    edges.push({
      from: 'input',
      to: 'target',
      bindings: [{ outputKey: 'text', inputKey: firstInputPort }],
    });
  }

  if (hasOutputs && firstOutputPort !== undefined) {
    edges.push({
      from: 'target',
      to: 'output',
      bindings: [{ outputKey: firstOutputPort, inputKey: 'text' }],
    });
  }

  const example = {
    dagId: `${nodeType}-example`,
    version: 1,
    status: 'active',
    nodes,
    edges,
  };

  io.write(`${JSON.stringify(example, null, JSON_INDENT_SPACES)}\n`);

  // Append usage hints as JSON comments (comment lines starting with #).
  io.write(
    [
      '',
      '# Save and run this example:',
      `#   dag node example ${nodeType} > example.dag.json`,
      `#   dag run example.dag.json --input text="Your input here"`,
      '#',
      '# Or pipe directly:',
      `#   dag node example ${nodeType} | dag run --stdin --input text="Your input"`,
      '',
    ].join('\n'),
  );

  return SUCCESS_EXIT_CODE;
}

/**
 * Execute the `robota-dag node` subcommand family.
 *
 * @param args - The argv slice starting after the `node` keyword.
 * @param options - IO abstraction.
 * @returns Exit code (0 = success, 1 = failure, 2 = usage error).
 */
export async function nodeCommand(
  args: readonly string[],
  options: INodeCommandOptions,
): Promise<number> {
  const { io } = options;
  const layout = options.workspace ?? DEFAULT_WORKSPACE_LAYOUT;

  const parseResult = parseNodeArgv(args);
  if (!parseResult.ok) {
    // AGENTUX-001: --help (exitCode 0) gets no "Error:" prefix
    if (parseResult.exitCode !== SUCCESS_EXIT_CODE) {
      io.write(`Error: ${parseResult.message}\n`);
    } else {
      io.write(`${parseResult.message}\n`);
    }
    return parseResult.exitCode;
  }

  const { subcommand, outputFormat } = parseResult;

  // AGENTUX-005: validate delegates directly — no registry needed
  if (subcommand === 'validate') {
    const filePath = parseResult.filePath;
    if (filePath === undefined) {
      io.write(`Error: node validate requires <file> argument.\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
    return handleValidateCommand(filePath, outputFormat, io);
  }

  // AGENTUX-003: for list/info, merge local custom nodes from CWD into the registry
  const noLocal = parseResult.noLocal === true;
  const localDefs =
    !noLocal && (subcommand === 'list' || subcommand === 'info')
      ? await loadLocalNodeDefinitions({ projectDir: process.cwd(), workspace: layout }).catch(
          () => [],
        )
      : [];
  const nodeDefinitions = [...createCliNodeRegistry(), ...localDefs];

  // Build manifests from node definitions
  const assemblyResult = buildNodeDefinitionAssembly(nodeDefinitions);
  if (!assemblyResult.ok) {
    io.write(`Error: Failed to build node registry: ${assemblyResult.error.message}\n`);
    return FAILURE_EXIT_CODE;
  }
  const manifests = assemblyResult.value.manifests;

  if (subcommand === 'list') {
    const externalPkgs =
      parseResult.includeExternal === true ? await discoverExternalNodePackages() : [];
    return handleListCommand(manifests, parseResult.category, outputFormat, io, externalPkgs);
  }

  if (subcommand === 'info') {
    // AGENTUX-008: --node-file loads the node explicitly and adds it to the registry
    if (parseResult.filePath !== undefined) {
      const explicitDef = await loadNodeFileExplicit(parseResult.filePath).catch((err: unknown) => {
        io.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        return null;
      });
      if (explicitDef === null) return FAILURE_EXIT_CODE;
      const defsWithExplicit = [
        ...nodeDefinitions.filter((d) => d.nodeType !== explicitDef.nodeType),
        explicitDef,
      ];
      const assemblyWithExplicit = buildNodeDefinitionAssembly(defsWithExplicit);
      if (!assemblyWithExplicit.ok) {
        io.write(`Error: Failed to build node registry: ${assemblyWithExplicit.error.message}\n`);
        return FAILURE_EXIT_CODE;
      }
      const resolvedType = parseResult.nodeType ?? explicitDef.nodeType;
      return handleInfoCommand(
        assemblyWithExplicit.value.manifests,
        resolvedType,
        outputFormat,
        io,
      );
    }
    const nodeType = parseResult.nodeType;
    if (nodeType === undefined) {
      io.write(`Error: node info requires <nodeType> argument.\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
    return handleInfoCommand(manifests, nodeType, outputFormat, io);
  }

  if (subcommand === 'schema') {
    const nodeType = parseResult.nodeType;
    if (nodeType === undefined) {
      io.write(`Error: node schema requires <nodeType> argument.\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
    return handleSchemaCommand(manifests, nodeType, outputFormat, io);
  }

  if (subcommand === 'example') {
    const nodeType = parseResult.nodeType;
    if (nodeType === undefined) {
      io.write(`Error: node example requires <nodeType> argument.\n`);
      return USAGE_ERROR_EXIT_CODE;
    }

    const { runFlag, runInputs } = parseResult;

    if (runFlag) {
      // --run: generate the example JSON, write to a temp file, execute, then clean up.
      return runExampleInPlace(manifests, nodeType, runInputs, io);
    }

    return handleExampleCommand(manifests, nodeType, io);
  }

  if (subcommand === 'scaffold') {
    const scaffoldName = parseResult.nodeType;
    if (scaffoldName === undefined) {
      io.write(`Error: node scaffold requires <name> argument.\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
    if (parseResult.localScaffold !== undefined) {
      return handleScaffoldLocalCommand(
        scaffoldName,
        parseResult.localScaffold,
        io,
        parseResult.dryRun === true,
        layout,
      );
    }
    return handleScaffoldCommand(scaffoldName, io, parseResult.jsFlag === true);
  }

  io.write(`Error: Unknown node subcommand.\n`);
  return USAGE_ERROR_EXIT_CODE;
}

/**
 * Generate an example DAG for `nodeType`, write it to a temp file,
 * delegate to `runCommand`, then remove the temp file.
 */
async function runExampleInPlace(
  manifests: INodeManifest[],
  nodeType: string,
  runInputs: readonly string[],
  io: IDagCliIo,
): Promise<number> {
  const manifest = manifests.find((m) => m.nodeType === nodeType);
  if (manifest === undefined) {
    io.write(`Error: Unknown node type "${nodeType}".\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  const config: Record<string, string> = DEFAULT_CONFIGS[nodeType] ?? {};
  const hasInputs = manifest.inputs.length > 0;
  const hasOutputs = manifest.outputs.length > 0;
  const firstInputPort = manifest.inputs.find((p) => p.required)?.key ?? manifest.inputs[0]?.key;
  const firstOutputPort = manifest.outputs.find((p) => p.required)?.key ?? manifest.outputs[0]?.key;

  const nodes: object[] = [];
  const edges: object[] = [];

  if (hasInputs) {
    nodes.push({
      nodeId: 'input',
      nodeType: 'input',
      dependsOn: [],
      config: {},
      position: { x: 100, y: 200 },
    });
  }

  nodes.push({
    nodeId: 'target',
    nodeType,
    dependsOn: hasInputs ? ['input'] : [],
    config,
    position: { x: 400, y: 200 },
  });

  if (hasOutputs) {
    nodes.push({
      nodeId: 'output',
      nodeType: 'text-output',
      dependsOn: ['target'],
      config: {},
      position: { x: 700, y: 200 },
    });
  }

  if (hasInputs && firstInputPort !== undefined) {
    edges.push({
      from: 'input',
      to: 'target',
      bindings: [{ outputKey: 'text', inputKey: firstInputPort }],
    });
  }

  if (hasOutputs && firstOutputPort !== undefined) {
    edges.push({
      from: 'target',
      to: 'output',
      bindings: [{ outputKey: firstOutputPort, inputKey: 'text' }],
    });
  }

  const example = {
    dagId: `${nodeType}-example`,
    version: 1,
    status: 'active',
    nodes,
    edges,
  };

  const tmpFile = join(tmpdir(), `${randomUUID()}.dag.json`);
  try {
    await writeFile(tmpFile, JSON.stringify(example, null, 2), 'utf8');
    const inputArgs = runInputs.flatMap((v) => ['--input', v]);
    return await runCommand([tmpFile, ...inputArgs], { io });
  } finally {
    await unlink(tmpFile).catch(() => {
      // allow-fallback: temp file cleanup failure is non-fatal
    });
  }
}

// AGENTUX-005/007: validate a local node file, check port schemas, and print its manifest
async function handleValidateCommand(
  filePath: string,
  outputFormat: string,
  io: IDagCliIo,
): Promise<number> {
  const writeError = (msg: string) => {
    if (outputFormat === OUTPUT_FORMAT_JSON) {
      io.write(
        `${JSON.stringify({ valid: false, filePath, error: msg }, null, JSON_INDENT_SPACES)}\n`,
      );
    } else {
      io.write(`Error: ${msg}\n`);
    }
  };

  const def = await loadNodeFileExplicit(filePath).catch((err: unknown) => {
    writeError(err instanceof Error ? err.message : String(err));
    return null;
  });
  if (def === null) return FAILURE_EXIT_CODE;

  const assemblyResult = buildNodeDefinitionAssembly([def]);
  if (!assemblyResult.ok) {
    writeError(assemblyResult.error.message);
    return FAILURE_EXIT_CODE;
  }
  const manifest = assemblyResult.value.manifests[0];
  if (manifest === undefined) {
    writeError(`no manifest produced for ${filePath}`);
    return FAILURE_EXIT_CODE;
  }

  // AGENTUX-007: port schema validation — each port must have a non-empty type string
  const portErrors: string[] = [];
  for (const port of manifest.inputs) {
    if (typeof port.type !== 'string' || port.type.trim() === '') {
      portErrors.push(`  Input port '${port.key}': missing or empty 'type' field`);
    }
  }
  for (const port of manifest.outputs) {
    if (typeof port.type !== 'string' || port.type.trim() === '') {
      portErrors.push(`  Output port '${port.key}': missing or empty 'type' field`);
    }
  }
  if (portErrors.length > 0) {
    const hint = `  Hint: run \`dag node scaffold --dry-run <name>\` to see the expected port shape.`;
    writeError(`${filePath} — invalid port schema:\n${portErrors.join('\n')}\n${hint}`);
    return FAILURE_EXIT_CODE;
  }

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    io.write(
      `${JSON.stringify(
        {
          valid: true,
          filePath,
          nodeType: manifest.nodeType,
          displayName: manifest.displayName,
          category: manifest.category,
          inputs: manifest.inputs.map((p) => ({
            key: p.key,
            type: p.type,
            required: p.required ?? false,
          })),
          outputs: manifest.outputs.map((p) => ({
            key: p.key,
            type: p.type,
            required: p.required ?? false,
          })),
        },
        null,
        JSON_INDENT_SPACES,
      )}\n`,
    );
    return SUCCESS_EXIT_CODE;
  }

  io.write(`✓ ${filePath} — valid\n\n`);
  return handleInfoCommand([manifest], manifest.nodeType, OUTPUT_FORMAT_PRETTY, io);
}

function buildScaffoldTs(name: string): string {
  const className = name
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return `import type {
  INodeManifest,
  INodeExecutionContext,
  TPortPayload,
} from '@robota-sdk/dag-core';

/** Node type identifier — must be unique across the registry. */
export const NODE_TYPE = '${name}' as const;

/** Input/output port declarations. */
export const manifest: INodeManifest = {
  nodeType: NODE_TYPE,
  displayName: '${className}',
  description: 'TODO: describe what this node does',
  category: 'utility',
  inputs: [
    { key: 'text', type: 'text', required: true, description: 'Input text' },
  ],
  outputs: [
    { key: 'text', type: 'text', description: 'Output text' },
  ],
  configSchema: {},
};

/** Execution logic. */
export async function execute(
  context: INodeExecutionContext,
): Promise<Record<string, TPortPayload>> {
  const input = context.getInput('text') as string | undefined;
  // TODO: implement your transformation here
  const output = input ?? '';
  return { text: output };
}
`;
}

// NODEDX-003: removed zod dependency — plain class, no configSchema
function buildScaffoldJs(nodeType: string): string {
  const pascalCase = nodeType
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  const displayName = nodeType
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
  return `class ${pascalCase}Node {
  nodeType = '${nodeType}';
  displayName = '${displayName}';
  category = 'Custom';
  defaultInputPort = 'text';
  defaultOutputPort = 'text';
  inputs = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  outputs = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
  ];
  configSchemaDefinition = null;
  taskHandler = {
    execute: async (input, _context) => {
      // TODO: implement logic using input.text
      return { ok: true, value: { text: String(input.text ?? '') } };
    },
  };
}

export default ${pascalCase}Node;
`;
}

// NODEDX-005: English output; NODEDX-001: this path reached only via --publish
async function handleScaffoldCommand(name: string, io: IDagCliIo, jsFlag = false): Promise<number> {
  if (jsFlag) {
    const outputFile = `${name}.dag.node.js`;
    const content = buildScaffoldJs(name);
    await writeFile(outputFile, content, 'utf8');
    io.write(`✓ Created ${outputFile}\n`);
    io.write(`Generated ${outputFile} for npm package publishing.\n`);
    return SUCCESS_EXIT_CODE;
  }
  const outputFile = `${name}.ts`;
  const content = buildScaffoldTs(name);
  await writeFile(outputFile, content, 'utf8');
  io.write(`✓ Created ${outputFile}\n\n`);
  io.write(`Next steps:\n`);
  io.write(`  1. Implement the execute() function in ${outputFile}\n`);
  io.write(`  2. Publish as an npm package: robota-dag-node-${name}\n`);
  io.write(`  3. Add robota-dag-node to your npm keywords\n`);
  io.write(`\nFull guide: dag node info input\n`);
  return SUCCESS_EXIT_CODE;
}

/** Parse "key:type" specs like "text:string" into { key, type } pairs. */
function parsePortSpec(spec: string): { key: string; portType: string } {
  const colon = spec.indexOf(':');
  if (colon === -1) return { key: spec, portType: 'string' };
  return { key: spec.slice(0, colon), portType: spec.slice(colon + 1) };
}

// NODEDX-004: new `export const node` format — no class boilerplate, no result envelope
// NODEDX-006: defaultOutputPort defaults to 'text' (unified across all scaffold modes)
interface IScaffoldPorts {
  readonly displayName: string;
  readonly inputs: ReadonlyArray<{ key: string; portType: string }>;
  readonly outputs: ReadonlyArray<{ key: string; portType: string }>;
  readonly configFields: ReadonlyArray<{ key: string; portType: string }>;
  readonly firstInput: string;
  readonly firstOutput: string;
}

function computeScaffoldPorts(nodeType: string, opts: ILocalScaffoldOptions): IScaffoldPorts {
  const displayName = nodeType
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
  const inputs =
    opts.inputs.length > 0 ? opts.inputs.map(parsePortSpec) : [{ key: 'text', portType: 'string' }];
  // NODEDX-006: default output key is 'text', matching built-in node convention
  const outputs =
    opts.outputs.length > 0
      ? opts.outputs.map(parsePortSpec)
      : [{ key: 'text', portType: 'string' }];
  const configFields = opts.configs.map(parsePortSpec);
  return {
    displayName,
    inputs,
    outputs,
    configFields,
    firstInput: inputs[0]?.key ?? 'text',
    firstOutput: outputs[0]?.key ?? 'text',
  };
}

/** DATA-002 P2/P3: the `.node.json` manifest — metadata SSOT, `kind:'code'`, pointing to the companion. */
function buildCodeNodeManifest(nodeType: string, p: IScaffoldPorts): string {
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const manifest = {
    kind: 'code',
    nodeType,
    displayName: p.displayName,
    category: 'Custom',
    defaultInputPort: p.firstInput,
    defaultOutputPort: p.firstOutput,
    inputs: p.inputs.map(({ key, portType }, i) => ({
      key,
      label: cap(key),
      order: i,
      type: portType,
      required: true,
    })),
    outputs: p.outputs.map(({ key, portType }, i) => ({
      key,
      label: cap(key),
      order: i,
      type: portType,
      required: false,
    })),
    codeFile: `${nodeType}.dag.node.js`,
  };
  return `${JSON.stringify(manifest, null, JSON_INDENT_SPACES)}\n`;
}

/** DATA-002 P2/P3: the supplementary `.dag.node.js` companion — behavior (`execute`) only. */
function buildCodeNodeCompanion(nodeType: string, p: IScaffoldPorts): string {
  const executeArgs =
    p.inputs.length === 1
      ? `{ ${p.firstInput} }`
      : `{ ${p.inputs.map(({ key }) => key).join(', ')} }`;
  const configAccessLines =
    p.configFields.length > 0
      ? p.configFields
          .map(({ key, portType }) => {
            const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            const defaultVal = portType === 'number' ? '0' : `''`;
            return `    const ${camel} = typeof context?.nodeDefinition?.config?.${camel} === '${portType}'\n      ? context.nodeDefinition.config.${camel}\n      : ${defaultVal};`;
          })
          .join('\n') + '\n'
      : '';
  const returnFields = p.outputs
    .map(({ key }) => `      ${key}: String(${p.firstInput} ?? ''), // TODO: implement`)
    .join('\n');

  return `// ${nodeType}.dag.node.js — behavior for the "${nodeType}" code node.
// Metadata (nodeType, ports) lives in ${nodeType}.node.json (the manifest); this file provides only execute().
// Run:  dag run --pipeline "input | ${nodeType} | text-output" --input text="Hello"

export const node = {
  async execute(${executeArgs}, context) {
${configAccessLines}    // TODO: implement your node logic here
    return {
${returnFields}
    };
  },
};
`;
}

// NODEDX-008 / DATA-002 P3 / FLOW-007: dryRun prints both files; otherwise writes the manifest +
// companion into the workspace `<root>/nodes/` (default `.workflows/nodes/`).
async function handleScaffoldLocalCommand(
  nodeType: string,
  opts: ILocalScaffoldOptions,
  io: IDagCliIo,
  dryRun = false,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<number> {
  const ports = computeScaffoldPorts(nodeType, opts);
  const manifestContent = buildCodeNodeManifest(nodeType, ports);
  const companionContent = buildCodeNodeCompanion(nodeType, ports);
  const manifestFile = `${nodeType}.node.json`;
  const companionFile = `${nodeType}.dag.node.js`;

  if (dryRun) {
    io.write(`// ${manifestFile}\n${manifestContent}\n// ${companionFile}\n${companionContent}`);
    return SUCCESS_EXIT_CODE;
  }

  const dir = nodesDir(opts.dir, layout);
  const manifestPath = join(dir, manifestFile);
  const companionPath = join(dir, companionFile);

  for (const p of [manifestPath, companionPath]) {
    let exists = false;
    try {
      await access(p);
      exists = true;
    } catch {
      // allow-fallback: access() failing means file does not exist — expected case
      exists = false;
    }
    if (exists) {
      io.write(`Error: file already exists: ${p}\n`);
      return USAGE_ERROR_EXIT_CODE;
    }
  }

  await mkdir(dir, { recursive: true });
  await writeFile(manifestPath, manifestContent, 'utf8');
  await writeFile(companionPath, companionContent, 'utf8');

  io.write(`✓ Created ${manifestPath}\n`);
  io.write(`✓ Created ${companionPath}\n`);
  io.write(`  nodeType: ${nodeType}\n`);
  io.write(
    `  inputs:   ${ports.inputs.map(({ key, portType }) => `${key} (${portType})`).join(', ')}\n`,
  );
  io.write(
    `  outputs:  ${ports.outputs.map(({ key, portType }) => `${key} (${portType})`).join(', ')}\n`,
  );
  if (opts.configs.length > 0) {
    io.write(`  config:   ${opts.configs.join(', ')}\n`);
  }
  io.write(`\nRun (auto-discovered from ${join(layout.root, 'nodes')}/):\n`);
  io.write(`  dag run --pipeline "input | ${nodeType} | text-output" --input text="Hello"\n`);

  return SUCCESS_EXIT_CODE;
}
