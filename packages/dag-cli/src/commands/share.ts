import { readFile } from 'node:fs/promises';
import type { IDagCliIo } from '../types.js';
import { FAILURE_EXIT_CODE, USAGE_ERROR_EXIT_CODE, SUCCESS_EXIT_CODE } from '../types.js';

const SHARE_DIVIDER = '──────────────────────────────────────────────────────────────';
const SHARE_TEXT_DIVIDER = '─────────────────────────────────────────';

const JSON_INDENT_SPACES = 2;
const UTF8_ENCODING = 'utf8';

const GITHUB_GIST_API = 'https://api.github.com/gists';

/** Supported share destinations. */
type TShareDestination = 'gist';

export interface IShareCommandOptions {
  readonly io: IDagCliIo;
}

/** Parsed options from argv for the `share` subcommand. */
interface IParsedShareOptions {
  readonly file: string;
  readonly destination: TShareDestination;
  readonly outputFormat: string;
  readonly shareText: boolean;
}

const OUTPUT_FORMAT_JSON = 'json';
const OUTPUT_FORMAT_PRETTY = 'pretty';

type TParseResult =
  | { readonly ok: true; readonly value: IParsedShareOptions }
  | { readonly ok: false; readonly exitCode: number; readonly message: string };

function takeSingleFlag(
  args: string[],
  flagName: string,
): { readonly value: string | undefined; readonly error?: string } {
  const idx = args.indexOf(flagName);
  if (idx === -1) return { value: undefined };
  const next = args[idx + 1];
  if (typeof next !== 'string' || next.startsWith('--')) {
    return { value: undefined, error: `${flagName} requires a value.` };
  }
  args.splice(idx, 2);
  return { value: next };
}

function parseShareArgv(args: readonly string[]): TParseResult {
  const mutableArgs = [...args];

  // --to <destination>
  const toResult = takeSingleFlag(mutableArgs, '--to');
  if (toResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: toResult.error };
  }
  let destination: TShareDestination = 'gist';
  if (toResult.value !== undefined) {
    if (toResult.value !== 'gist') {
      return {
        ok: false,
        exitCode: USAGE_ERROR_EXIT_CODE,
        message: `--to must be "gist". Got: "${toResult.value}".`,
      };
    }
    destination = toResult.value;
  }

  // --output <format>
  const outputResult = takeSingleFlag(mutableArgs, '--output');
  if (outputResult.error) {
    return { ok: false, exitCode: USAGE_ERROR_EXIT_CODE, message: outputResult.error };
  }
  const outputFormat = outputResult.value ?? OUTPUT_FORMAT_PRETTY;
  if (outputFormat !== OUTPUT_FORMAT_PRETTY && outputFormat !== OUTPUT_FORMAT_JSON) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `--output must be "pretty" or "json". Got: "${outputFormat}".`,
    };
  }

  // --share-text flag
  const shareTextIdx = mutableArgs.indexOf('--share-text');
  const shareText = shareTextIdx !== -1;
  if (shareText) mutableArgs.splice(shareTextIdx, 1);

  // Positional: file (first non-flag argument)
  const positional = mutableArgs.filter((a) => !a.startsWith('--'));
  const unknownFlags = mutableArgs.filter((a) => a.startsWith('--'));

  if (unknownFlags.length > 0) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `share received unexpected flags: ${unknownFlags.join(' ')}.`,
    };
  }

  const file = positional[0];
  if (!file) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message:
        'share requires <file> argument (e.g. dag share workflow.dag.json).\n\nUsage:\n  dag share <file> [--to gist] [--output pretty|json] [--share-text]\n\nOptions:\n  --to gist          Share via GitHub Gist (default)\n  --output pretty    Output format (default: pretty)\n  --share-text       Generate Twitter/X share text after sharing\n\nRequires GITHUB_TOKEN environment variable.',
    };
  }
  if (positional.length > 1) {
    return {
      ok: false,
      exitCode: USAGE_ERROR_EXIT_CODE,
      message: `share received unexpected positional arguments: ${positional.slice(1).join(' ')}.`,
    };
  }

  return {
    ok: true,
    value: { file, destination, outputFormat, shareText },
  };
}

/**
 * Detect values that look like hardcoded API keys.
 * Keeps environment variable references like `${ANTHROPIC_API_KEY}` intact.
 */
function looksLikeSensitiveValue(value: string): boolean {
  // Env-var reference — safe to keep.
  if (value.startsWith('${') && value.endsWith('}')) {
    return false;
  }
  // Known API key prefixes.
  if (/^(sk-|ghp_|eyJ)[A-Za-z0-9_-]{20,}/.test(value)) {
    return true;
  }
  // Long base64/hex-looking strings.
  if (value.length > 40 && /^[A-Za-z0-9+/=_-]+$/.test(value)) {
    return true;
  }
  return false;
}

function sanitizeConfigValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return looksLikeSensitiveValue(value) ? '${REDACTED}' : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeConfigValue);
  }
  if (typeof value === 'object' && value !== null) {
    return sanitizeConfig(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    result[key] = sanitizeConfigValue(value);
  }
  return result;
}

function resolveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Derive `--input` placeholder arguments from a parsed DAG JSON object.
 * Looks for nodes of type "input" and uses "text" as the default port key.
 */
function buildInputPlaceholders(parsed: Record<string, unknown>): string {
  const nodes = parsed['nodes'];
  if (!Array.isArray(nodes)) return '--input text="your input here"';

  const hasInputNode = nodes.some(
    (n) =>
      typeof n === 'object' && n !== null && (n as Record<string, unknown>)['nodeType'] === 'input',
  );

  return hasInputNode ? '--input text="your input here"' : '';
}

/**
 * Generate a Twitter/X share text for a DAG workflow.
 */
export function generateShareText(
  dagId: string,
  durationMs: number,
  nodeCount: number,
  gistUrl?: string,
): string {
  const durationS = (durationMs / 1000).toFixed(1);
  const runLine = gistUrl
    ? `🔗 npx @robota-sdk/dag-cli run <gist-url>`
    : `🔗 npx @robota-sdk/dag-cli run <gist-url>`;
  return [
    `[Share text — ready to paste on Twitter/X]`,
    SHARE_TEXT_DIVIDER,
    `Just ran the "${dagId}" pipeline in ${durationS}s with @robota_dag 🚀`,
    ``,
    `${nodeCount} nodes connected with a single CLI command.`,
    `No server required — runs anywhere with npx.`,
    ``,
    runLine,
    `#robota_dag #AI #workflow`,
    SHARE_TEXT_DIVIDER,
  ].join('\n');
}

/**
 * Build the raw Gist URL for a specific file inside a Gist.
 * Format: https://gist.githubusercontent.com/{owner}/{gist_id}/raw/{filename}
 */
function buildRawGistUrl(gistResponse: IGistCreateResponse, gistFileName: string): string {
  // Prefer the raw_url from the API response if available.
  const fileEntry = gistResponse.files[gistFileName];
  if (fileEntry?.raw_url) {
    return fileEntry.raw_url;
  }
  // Fallback: derive from html_url.
  // html_url format: https://gist.github.com/{owner}/{gist_id}
  return `${gistResponse.html_url}/raw/${gistFileName}`;
}

interface IGistCreateResponse {
  readonly html_url: string;
  readonly files: Record<string, { readonly raw_url: string }>;
}

async function createGist(
  fileName: string,
  content: string,
  token: string,
): Promise<IGistCreateResponse> {
  const body = JSON.stringify({
    description: `DAG workflow shared via robota-dag CLI`,
    public: true,
    files: {
      [fileName]: { content },
    },
  });

  const response = await fetch(GITHUB_GIST_API, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response // allow-fallback: response body read failure falls back to a placeholder for error context
      .text()
      .catch(() => '(no body)');
    throw new Error(
      `GitHub Gist API returned ${response.status} ${response.statusText}: ${errorText}`,
    );
  }

  return response.json() as Promise<IGistCreateResponse>;
}

type TReadFileResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly message: string };

async function tryReadFile(filePath: string): Promise<TReadFileResult> {
  try {
    const text = await readFile(filePath, UTF8_ENCODING);
    return { ok: true, text };
  } catch (err) {
    // allow-fallback: file read error is converted to a structured error result
    return { ok: false, message: resolveErrorMessage(err) };
  }
}

type TParseJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

function tryParseJson(text: string): TParseJsonResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    // allow-fallback: JSON parse error is converted to a structured error result
    return { ok: false, message: resolveErrorMessage(err) };
  }
}

type TGistResult =
  | { readonly ok: true; readonly response: IGistCreateResponse }
  | { readonly ok: false; readonly message: string };

async function tryCreateGist(
  fileName: string,
  content: string,
  token: string,
): Promise<TGistResult> {
  try {
    const response = await createGist(fileName, content, token);
    return { ok: true, response };
  } catch (err) {
    // allow-fallback: API error is converted to a structured error result
    return { ok: false, message: resolveErrorMessage(err) };
  }
}

/**
 * Execute the `dag share <file>` subcommand.
 *
 * @param args - The argv slice starting after the `share` keyword.
 * @param options - IO abstraction.
 * @returns Exit code (0 = success, 1 = failure, 2 = usage error).
 */
export async function shareCommand(
  args: readonly string[],
  options: IShareCommandOptions,
): Promise<number> {
  const { io } = options;

  // Show help if --help flag is present.
  if (args.includes('--help') || args.includes('-h')) {
    io.write(
      [
        'Usage: dag share <file> [--to gist] [--output pretty|json] [--share-text]',
        '',
        'Share a DAG workflow file via a public URL.',
        '',
        'Arguments:',
        '  <file>               Path to the .dag.json file to share',
        '',
        'Options:',
        '  --to gist            Share via GitHub Gist (default)',
        '  --output pretty      Output format: pretty (default) or json',
        '  --share-text         Generate Twitter/X share text after sharing',
        '  --help               Show this help message',
        '',
        'Environment variables:',
        '  GITHUB_TOKEN   GitHub personal access token with "gist" scope',
        '',
        'To create a token:',
        '  https://github.com/settings/tokens/new?scopes=gist',
        '',
      ].join('\n'),
    );
    return SUCCESS_EXIT_CODE;
  }

  const parseResult = parseShareArgv(args);
  if (!parseResult.ok) {
    io.write(`Error: ${parseResult.message}\n`);
    return parseResult.exitCode;
  }

  const { file, outputFormat, shareText } = parseResult.value;

  // Check for GitHub token.
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    io.write(
      [
        'Error: GITHUB_TOKEN environment variable is not set.',
        '',
        'To share via GitHub Gist, create a personal access token with the "gist" scope:',
        '  https://github.com/settings/tokens/new?scopes=gist',
        '',
        'Then set it in your shell:',
        '  export GITHUB_TOKEN=<your-token>',
        '',
      ].join('\n'),
    );
    return FAILURE_EXIT_CODE;
  }

  // Read the DAG file.
  const readResult = await tryReadFile(file);
  if (!readResult.ok) {
    io.write(`Error: Failed to read file "${file}": ${readResult.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  // Parse JSON.
  const parseJsonResult = tryParseJson(readResult.text);
  if (!parseJsonResult.ok) {
    io.write(`Error: Failed to parse JSON from "${file}": ${parseJsonResult.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const parsed = parseJsonResult.value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    io.write(`Error: "${file}" must contain a JSON object.\n`);
    return FAILURE_EXIT_CODE;
  }

  // Sanitize sensitive config values before sharing.
  const parsedRecord = parsed as Record<string, unknown>;
  const sanitized = sanitizeConfig(parsedRecord);
  const sanitizedText = JSON.stringify(sanitized, null, JSON_INDENT_SPACES);

  // Derive a clean filename for the Gist.
  const gistFileName = file.replace(/^.*[\\/]/, '');

  if (outputFormat === OUTPUT_FORMAT_PRETTY) {
    io.write('Sharing via GitHub Gist...\n');
  }

  const gistResult = await tryCreateGist(gistFileName, sanitizedText, token);
  if (!gistResult.ok) {
    io.write(`Error: ${gistResult.message}\n`);
    return FAILURE_EXIT_CODE;
  }

  const { response: gistResponse } = gistResult;

  // Build the raw URL for the uploaded file.
  const rawUrl = buildRawGistUrl(gistResponse, gistFileName);

  // Build run command with auto-detected input placeholders.
  const inputPlaceholder = buildInputPlaceholders(parsedRecord);
  const runCommand = inputPlaceholder
    ? `npx @robota-sdk/dag-cli run \\\n    ${rawUrl} \\\n    ${inputPlaceholder}`
    : `npx @robota-sdk/dag-cli run \\\n    ${rawUrl}`;

  if (outputFormat === OUTPUT_FORMAT_JSON) {
    io.write(
      `${JSON.stringify(
        {
          gistUrl: gistResponse.html_url,
          rawUrl,
          runCommand: inputPlaceholder
            ? `npx @robota-sdk/dag-cli run ${rawUrl} ${inputPlaceholder}`
            : `npx @robota-sdk/dag-cli run ${rawUrl}`,
        },
        null,
        JSON_INDENT_SPACES,
      )}\n`,
    );
    return SUCCESS_EXIT_CODE;
  }

  // Pretty output.
  io.write(
    [
      '✓ Shared via GitHub Gist',
      '',
      'Share this with anyone:',
      SHARE_DIVIDER,
      `  ${runCommand}`,
      SHARE_DIVIDER,
      '',
      `Gist URL: ${gistResponse.html_url}`,
      `Raw URL:  ${rawUrl}`,
      '',
      'Tip: Submit to community → https://github.com/woojubb/robota/discussions',
      '',
    ].join('\n'),
  );

  if (shareText) {
    const dagId =
      (parsedRecord['dagId'] as string | undefined) ?? gistFileName.replace(/\.dag\.json$/, '');
    const nodeCount = Array.isArray(parsedRecord['nodes']) ? parsedRecord['nodes'].length : 0;
    // durationMs not available here (no execution occurred), use 0 as placeholder
    io.write('\n');
    io.write(generateShareText(dagId, 0, nodeCount, gistResponse.html_url));
    io.write('\n');
  }

  return SUCCESS_EXIT_CODE;
}
