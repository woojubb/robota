/**
 * Best-effort masking of captured prompt/response text before it leaves the process. It runs in
 * the export worker, never in the turn: known credential shapes and the literal secrets the host
 * knows about are masked, workspace and home paths are shortened by whole segment, control
 * characters are neutralised, and only then is the text cut to its exact bound — so a cut can
 * never expose the tail of a secret the full text would have masked.
 */
import { realpathSync } from 'node:fs';
import { redactDiagnosticText } from '@robota-sdk/agent-command';

const REDACTED = '[redacted]';
const TRUNCATED = '[truncated]';
/** A partial token at the cut edge at least this long is masked: it may be the head of a secret. */
const EDGE_TOKEN_MIN = 8;

/**
 * JWT-shaped text is found by scanning each run of token characters once. A `\beyJ…\.…\.…` pattern
 * restarts after every `-` inside a run, which made long runs quadratic. From the first `eyJ` that
 * starts a word, a run holding two more dots is masked to its end — over-masking is the safe side.
 */
const TOKEN_RUN = /(?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]+/gu;

function maskJwtRuns(text: string): string {
  return text.replace(TOKEN_RUN, (run) => {
    let start = run.indexOf('eyJ');
    while (start > 0 && run[start - 1] !== '-' && run[start - 1] !== '.') start = run.indexOf('eyJ', start + 1);
    if (start < 0) return run;
    const firstDot = run.indexOf('.', start);
    if (firstDot < 0 || run.indexOf('.', firstDot + 1) < 0) return run;
    return `${run.slice(0, start)}${REDACTED}`;
  });
}

/** Shapes beyond the doctor's own, each replaced whole. */
const EXTRA_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/gu,
  /\bgh[ousr]_[A-Za-z0-9]{20,}/gu,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}/gu,
  /\bnpm_[A-Za-z0-9]{20,}/gu,
  /\bglpat-[A-Za-z0-9_-]{20,}/gu,
];
/** `curl -u user:pass` — the whole credential pair. */
const USER_PASS_FLAG = /(^|\s)(-u\s+)(?:"[^"\s]*:[^"]*"|'[^'\s]*:[^']*'|[^\s:]+:\S+)/gu;
/** `SOMETHING_KEY=value`, `API_TOKEN="…"`, `db_password=…`: the name stays, the value goes. */
const SECRET_ASSIGNMENT = /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=(?:"[^"]*"|'[^']*'|\S+)/giu;
/**
 * A JSON pair whose name looks secret (`"session_token": "…"`): the name stays, the value goes.
 * Every repetition is bounded, so the work per starting position is bounded and the scan stays
 * linear in the input however hostile it is.
 */
const SECRET_JSON_PAIR =
  /("[^"\\]{0,128}(?:secret|token|password|passwd|passphrase|cookie|auth|credential|signature|bearer|jwt|(?:api|private|access|signing)[_-]?key)[^"\\]{0,128}"\s{0,16}:\s{0,16})"(?:[^"\\]|\\.){0,8192}"/giu;
/**
 * A secret header line, also indented or quoted as `curl -v` prints it (`> Cookie: …`): the prefix
 * and name stay, the value goes.
 */
const SECRET_HEADER_LINE =
  /^([ \t>]{0,8}(?:proxy-)?(?:authorization|cookie|set-cookie|x-[\w-]{0,64}(?:token|key|secret|auth)))[ \t]{0,16}:[^\r\n]*$/gimu;
/** C0 and C1 controls (and DEL), except newline and tab. */
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Replace `path` only where it is a whole path: not preceded by a path character (so `/x/home/al`
 * is not `/home/al`, though `file:///home/al` is) and not followed by one (so `/home/alice` is not `/home/al`); a trailing full stop still ends it.
 */
function maskPath(text: string, path: string, replacement: string): string {
  const trimmed = path.replace(/[\\/]+$/u, '');
  if (trimmed.length < 2) return text;
  const pattern = new RegExp(`(?:(?<=file://)|(?<![\\w.~/\\\\-]))${escapeRegExp(trimmed)}(?![\\w~-]|\\.[\\w])`, 'gu');
  return text.replace(pattern, replacement);
}

function utf8Prefix(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

/** How known credential shapes begin; a short edge token that could be one of their heads is masked too. */
const SECRET_PREFIXES = [
  'sk-', 'sk_live_', 'rk_live_', 'AKIA', 'ASIA', 'AIza', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_',
  'github_pat_', 'eyJ', 'npm_', 'glpat-', 'xoxa-', 'xoxb-', 'xoxp-', 'xoxr-', 'xoxs-', '-----BEGIN',
];

function mayBeSecretHead(token: string): boolean {
  // The part after an assignment or quote, e.g. `KEY=sk-a` or `"AKI`.
  const tail = token.slice(Math.max(...['=', ':', '"', "'", '(', '`'].map((mark) => token.lastIndexOf(mark))) + 1);
  return [token, tail].some((part) => part.length >= 2 &&
    SECRET_PREFIXES.some((prefix) => part.startsWith(prefix) || prefix.startsWith(part)));
}

/** Drop a partial token at the cut edge — marking it — so a cut cannot leave a secret's head. */
function maskCutEdge(text: string, maxBytes: number): string {
  const edge = /\S+$/u.exec(text);
  if (!edge || (edge[0].length < EDGE_TOKEN_MIN && !mayBeSecretHead(edge[0]))) return text;
  const prefix = text.slice(0, edge.index);
  return Buffer.byteLength(prefix, 'utf8') + TRUNCATED.length <= maxBytes ? prefix + TRUNCATED : prefix;
}

export interface ILiveContentRedactionContext {
  /** Re-read for every batch, so a provider switched mid-session is masked from its first turn. */
  readonly getSecrets: () => Iterable<string>;
  /** Workspace paths masked to `<workspace>`: the working directory and the project root. */
  readonly cwd: string;
  readonly projectRoot?: string;
  /** Masked to `~` after the workspace paths. */
  readonly homedir: string;
}

export interface ILiveContentRedactedText {
  readonly text: string;
  /** The redacted text was cut to fit the bound (or arrived already pre-truncated). */
  readonly truncated: boolean;
}

export type TLiveContentRedactor = (
  text: string, maxBytes: number, preTruncated: boolean,
) => ILiveContentRedactedText;

/** Each path as written and as resolved (a symlinked home or workspace), longest first. */
function withRealPaths(values: readonly (string | undefined)[]): string[] {
  const paths = new Set<string>();
  for (const value of values) {
    if (value === undefined) continue;
    try { paths.add(realpathSync(value)); } catch { /* an unreadable path still masks its plain form */ }
    paths.add(value);
  }
  return [...paths].sort((a, b) => b.length - a.length);
}

/**
 * Prepare one batch's redactor. Throws when the secrets cannot be read — the caller then drops the
 * whole batch, because masking without them could export a credential the host knows about.
 */
export function prepareLiveContentRedactor(context: ILiveContentRedactionContext): TLiveContentRedactor {
  const secrets = [...new Set([...context.getSecrets()].filter((value) => typeof value === 'string'))]
    .sort((a, b) => b.length - a.length);
  const paths = withRealPaths([context.cwd, context.projectRoot]);
  const homes = withRealPaths([context.homedir]);
  return (text, maxBytes, preTruncated) => {
    let out = redactDiagnosticText(text, secrets);
    for (const shape of EXTRA_SHAPES) out = out.replace(shape, REDACTED);
    out = maskJwtRuns(out);
    out = out.replace(USER_PASS_FLAG, `$1$2${REDACTED}`);
    out = out.replace(SECRET_ASSIGNMENT, `$1=${REDACTED}`);
    out = out.replace(SECRET_JSON_PAIR, `$1"${REDACTED}"`);
    out = out.replace(SECRET_HEADER_LINE, `$1: ${REDACTED}`);
    for (const path of paths) out = maskPath(out, path, '<workspace>');
    for (const home of homes) out = maskPath(out, home, '~');
    out = out.replace(CONTROLS, '\uFFFD');
    const cut = utf8Prefix(out, maxBytes);
    const truncated = preTruncated || cut.length !== out.length;
    return { text: truncated ? maskCutEdge(cut, maxBytes) : cut, truncated };
  };
}
