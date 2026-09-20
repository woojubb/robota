/**
 * FLOW-2006: the `robota://open` launch intent — the whole security boundary of a deep link.
 *
 * The parser is fail-closed by construction. One verb, four allowed keys, a required version, and
 * any violation discards the WHOLE url naming the first rule broken (OWASP's discard-don't-partially-
 * process). Unknown keys are REFUSED rather than ignored, which is what makes "a link cannot smuggle
 * configuration" true rather than reviewed: a future `?provider=` or `?permission-mode=` cannot be
 * accepted by accident.
 */

/** The only contract version this build accepts. */
export const LAUNCH_INTENT_VERSION = '1';
/** Whole-url cap, in Unicode code points, checked before anything is decoded. */
export const LAUNCH_INTENT_MAX_URL = 8192;
/** Prompt cap after decoding, in Unicode code points (Claude Code's documented cap). */
export const LAUNCH_INTENT_MAX_PROMPT = 5000;
/** The closed allowlist. A key outside it is a refusal, never a silent drop. */
export const LAUNCH_INTENT_KEYS: readonly string[] = ['v', 'prompt', 'cwd', 'repo'];

export const LAUNCH_INTENT_USAGE =
  "Usage: robota open 'robota://open?v=1&prompt=<text>[&cwd=<absolute path>|&repo=<owner/name>]'";

export interface ILaunchIntent {
  readonly version: string;
  readonly prompt: string | undefined;
  readonly cwd: string | undefined;
  readonly repo: string | undefined;
  /** True when both targets were present: `cwd` wins and `repo` was superseded. */
  readonly repoSuperseded: boolean;
}

export type TLaunchIntentParse =
  | { readonly ok: true; readonly intent: ILaunchIntent }
  | { readonly ok: false; readonly reason: string };

/** Length in code points — an emoji or a Hangul syllable counts once, wherever it appears. */
function codePointLength(value: string): number {
  return [...value].length;
}

/**
 * Characters a prompt may not carry: every C0/C1 control except newline and tab, and the
 * invisible/bidirectional formatting class that makes rendered text lie about its own content.
 */
/* eslint-disable no-control-regex -- matching the control class IS the rule */
const FORBIDDEN_TEXT =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;
/** The same class for a path, where a newline and a tab are not legitimate either. */
const FORBIDDEN_PATH = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;
/* eslint-enable no-control-regex */
const REPO_SLUG = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;

/** Longest attacker-controlled fragment a refusal will echo back. */
const REFUSAL_ECHO_MAX = 80;
/** Escapes are written the way a reader recognises them: `\\u{1b}`, not `\\u{27}`. */
const ESCAPE_RADIX = 16;

/**
 * Render an attacker-controlled value for a message a TERMINAL will print.
 *
 * The refusal is the one output whose entire job is to be seen, and the values it names come
 * straight out of the link: a `key` or a `repo` carrying `ESC[2J ESC[H` would clear the screen and
 * repaint it, erasing the very warning it triggered. So every control and invisible-formatting
 * character becomes a visible escape, and the echo is clamped — the reader needs to RECOGNISE the
 * offending value, not to receive all of it.
 */
export function echoValue(value: string): string {
  const escaped = [...value]
    .map((ch) =>
      FORBIDDEN_PATH.test(ch) ? `\\u{${(ch.codePointAt(0) ?? 0).toString(ESCAPE_RADIX)}}` : ch,
    )
    .join('');
  const points = [...escaped];
  return points.length > REFUSAL_ECHO_MAX
    ? `${points.slice(0, REFUSAL_ECHO_MAX).join('')}\u2026`
    : escaped;
}

function refuse(reason: string): TLaunchIntentParse {
  return { ok: false, reason: `${reason}\n${LAUNCH_INTENT_USAGE}` };
}

/** `robota://open`, `robota://open/` and the authority-less `robota:open`, verb case-insensitive. */
function verbOf(url: URL): string | undefined {
  const host = url.host.toLowerCase();
  const path = url.pathname;
  if (host.length > 0) return path === '' || path === '/' ? host : undefined;
  return path.toLowerCase();
}

/** What a per-field check may hand back: the field's value, or the refusal that ends the parse. */
type TChecked = string | undefined | Map<string, string> | TLaunchIntentParse;

function isRefusal(value: TChecked): value is TLaunchIntentParse {
  return typeof value === 'object' && value !== null && !(value instanceof Map);
}

function readQuery(url: URL): TLaunchIntentParse | Map<string, string> {
  const values = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (!LAUNCH_INTENT_KEYS.includes(key)) {
      return refuse(
        `\`${echoValue(key)}\` is not an accepted key; only ${LAUNCH_INTENT_KEYS.join(', ')} are.`,
      );
    }
    if (values.has(key)) return refuse(`\`${echoValue(key)}\` appears more than once.`);
    values.set(key, value);
  }
  return values;
}

function checkPrompt(prompt: string | undefined): string | TLaunchIntentParse | undefined {
  if (prompt === undefined) return undefined;
  // A link authored on Windows or pasted out of a CRLF runbook is not a malformed link.
  const normalized = prompt.replace(/\r\n/g, '\n');
  if (normalized.includes('\r')) return refuse('the prompt contains a carriage return.');
  if (FORBIDDEN_TEXT.test(normalized)) {
    return refuse('the prompt contains a control or invisible formatting character.');
  }
  if (codePointLength(normalized) > LAUNCH_INTENT_MAX_PROMPT) {
    return refuse(`the prompt is longer than ${LAUNCH_INTENT_MAX_PROMPT} characters.`);
  }
  // `TuiInteractionChannel.handleInput` routes a leading `/` to the slash-command path, so without
  // this rule one link would run `/mode bypassPermissions` locally — with zero provider calls.
  if (normalized.trimStart().startsWith('/')) {
    return refuse('a link may carry a prompt but not a command: the prompt begins with `/`.');
  }
  return normalized;
}

function checkCwd(cwd: string | undefined): string | TLaunchIntentParse | undefined {
  if (cwd === undefined) return undefined;
  if (FORBIDDEN_PATH.test(cwd)) {
    return refuse('the cwd contains a control or invisible formatting character.');
  }
  if (cwd.startsWith('\\\\') || cwd.startsWith('//')) {
    return refuse('the cwd is a UNC or network path.');
  }
  const posixAbsolute = cwd.startsWith('/');
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(cwd);
  if (!posixAbsolute && !windowsAbsolute) return refuse('the cwd is not an absolute path.');
  if (cwd.split(/[\\/]/).includes('..')) return refuse('the cwd contains a `..` segment.');
  return cwd;
}

/** The query's own rules — version, prompt, and exactly one usable target. */
function readIntent(query: Map<string, string>): TLaunchIntentParse {
  const version = query.get('v');
  if (version === undefined) return refuse('the link carries no `v`.');
  if (version !== LAUNCH_INTENT_VERSION) {
    return refuse(`\`v=${echoValue(version)}\` is not version ${LAUNCH_INTENT_VERSION}.`);
  }

  const prompt = checkPrompt(query.get('prompt'));
  if (isRefusal(prompt)) return prompt;
  const cwd = checkCwd(query.get('cwd'));
  if (isRefusal(cwd)) return cwd;
  const repo = query.get('repo');
  if (repo !== undefined && !REPO_SLUG.test(repo)) {
    return refuse(`\`${echoValue(repo)}\` is not an \`owner/name\` slug.`);
  }
  if (cwd === undefined && repo === undefined) {
    return refuse('the link names no target: pass `cwd` or `repo`.');
  }

  return {
    ok: true,
    intent: {
      version,
      prompt,
      cwd,
      repo: cwd === undefined ? repo : undefined,
      repoSuperseded: cwd !== undefined && repo !== undefined,
    },
  };
}

/** Parse a launch intent, or refuse the whole url naming the first rule it broke. */
export function parseLaunchIntent(raw: string): TLaunchIntentParse {
  if (codePointLength(raw) > LAUNCH_INTENT_MAX_URL) {
    return refuse(`the link is longer than ${LAUNCH_INTENT_MAX_URL} characters.`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse('the link is not a URL.');
  }
  if (url.protocol !== 'robota:') {
    return refuse(`\`${echoValue(url.protocol)}\` is not the \`robota:\` scheme.`);
  }
  if (url.hash.length > 0) return refuse('the link carries a fragment.');
  if (verbOf(url) !== 'open') return refuse('the only accepted form is `robota://open`.');

  const query = readQuery(url);
  if (isRefusal(query)) return query;
  return readIntent(query);
}

/**
 * Build a link from an intent. Module-internal on purpose — no caller exists yet, and the round trip
 * is what the tests assert through this module's own boundary.
 */
export function encodeLaunchIntent(intent: Omit<ILaunchIntent, 'repoSuperseded'>): string {
  const query = new URLSearchParams();
  query.set('v', intent.version);
  if (intent.prompt !== undefined) query.set('prompt', intent.prompt);
  if (intent.cwd !== undefined) query.set('cwd', intent.cwd);
  if (intent.repo !== undefined) query.set('repo', intent.repo);
  return `robota://open?${query.toString()}`;
}
