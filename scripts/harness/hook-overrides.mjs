/**
 * INFRA-112 (issue #1904) — the single owner of "which escape-hatch forms does this hook accept".
 *
 * Every guard in `.claude/hooks/` declares an escape hatch. What it ACCEPTS is decided by the code
 * reading the variable; what it is DECLARED to accept was written by hand in up to five other places
 * — the refusal message, a second refusal in the same file, the rule section, the card in AGENTS.md,
 * and a task record — and nothing compared any of them to the code. Both drift directions were
 * measured on the integration branch before this module existed.
 *
 * This module does not hold a list of accepted forms. It DERIVES them from the hook source, because
 * a hand-kept list would be a sixth copy of exactly the thing that drifted.
 *
 * ## The two mechanisms, and why the distinction is not cosmetic
 *
 * **Statement-scoped inline** — the hook greps the command STRING for `VAR=1` prefixing the guarded
 * command. It excuses only the statement it prefixes, so `VAR=1 date; git push` does not disarm the
 * push. `merge-gate.sh` says this on itself: "It must be inline because this hook reads the command".
 *
 * **Environment** — the hook reads `${VAR:-}` from its own environment. A PreToolUse hook runs as a
 * separate process, so an inline assignment on the agent's command never reaches it; only a variable
 * exported into the session does. That form therefore stays armed for every later command until it is
 * unset, which is the opposite lifetime from the inline one.
 *
 * A reader told "inline" about an environment-only hatch will type something that does not work. A
 * reader told "inline" about a hook that also accepts the environment does not know a bypass can
 * outlive the command that set it. Neither is a documentation nicety.
 */

/** `${VAR}`, `${VAR:-x}`, `${!token}` indirection, and a bare `$VAR` test. */
function readsEnvironment(source, name) {
  const braced = new RegExp(String.raw`\$\{!?${name}[:}]`);
  const bare = new RegExp(String.raw`\$${name}\b`);
  return braced.test(source) || bare.test(source);
}

/**
 * An inline acceptor is a regex that binds `VAR=1` to a position in the command string.
 *
 * Matched on `NAME=1` appearing inside a pattern rather than in prose, which is what separates an
 * acceptor from a refusal message telling the reader to type it.
 */
function readsInline(source, name) {
  // A LINE containing both `NAME=1` and a POSIX character class is a regex, not prose. The first cut
  // of this required `[[:space:]]` immediately beside `NAME=1` and missed both `merge-gate.sh` and
  // `pre-push-check.sh`, whose acceptors read `NAME=1([[:space:]]+...` — a capture group sits between
  // them. Checking both directions is what surfaced that: the detector reported two hooks as
  // accepting nothing, and two hooks that accept nothing would be a finding, not a quiet zero.
  return source
    .split('\n')
    .some((line) => line.includes(`${name}=1`) && /\[\[:(space|alnum|alpha):\]\]/.test(line));
}

/**
 * Indirect acceptors: a helper taking the variable NAME as an argument.
 *
 * `branch-guard.sh` routes six variables through `stmt_override`, which tests `${!token:-0}` AND the
 * statement regex — so those six accept both forms while the name appears beside neither construct.
 * Reading the call site is the only way to see that; a scan that looked for the constructs alone
 * would report six false "declared but not accepted" findings.
 */
const INDIRECT = [{ helper: 'stmt_override', environment: true, inline: true }];

function indirectForms(source, name) {
  for (const entry of INDIRECT) {
    if (new RegExp(String.raw`\b${entry.helper}\s+${name}\b`).test(source)) return entry;
  }
  return undefined;
}

/** Every override-shaped variable name a hook mentions at all. */
export function overrideNamesIn(source) {
  const names = new Set();
  const pattern = /\b[A-Z][A-Z0-9_]*(?:_ACK|_ALLOW[A-Z0-9_]*|_SKIP[A-Z0-9_]*)\b/g;
  for (const match of source.matchAll(pattern)) names.add(match[0]);
  return [...names].sort();
}

/**
 * What one hook accepts, per variable.
 *
 * A name it mentions but neither reads nor matches is reported with both forms false — that is a
 * variable the hook only TALKS about, which is either another hook's hatch named in prose or a
 * declaration with nothing behind it. The caller decides which; this module reports what it found.
 */
export function acceptedFormsIn(source) {
  const forms = {};
  for (const name of overrideNamesIn(source)) {
    const indirect = indirectForms(source, name);
    forms[name] = indirect
      ? { environment: indirect.environment, inline: indirect.inline }
      : { environment: readsEnvironment(source, name), inline: readsInline(source, name) };
  }
  return forms;
}

let examinedHooks = 0;

/** How many hook files this run actually read. Reset per call, never accumulated across runs. */
export function examinedHookCount() {
  return examinedHooks;
}

/**
 * Derive the accepted forms for every hook.
 *
 * A variable accepted by MORE than one hook is merged permissively: if any hook accepts the inline
 * form, the inline form works somewhere, and a declaration naming it is not wrong. Reporting per-hook
 * would be stricter but unreadable, because the declarations name the variable, not the file.
 */
export function collectAcceptedForms(hookPaths, readFile) {
  examinedHooks = 0;
  const merged = new Map();
  for (const hookPath of hookPaths) {
    examinedHooks += 1;
    const forms = acceptedFormsIn(readFile(hookPath));
    for (const [name, form] of Object.entries(forms)) {
      const found = merged.get(name) ?? { environment: false, inline: false, hooks: [] };
      if (form.environment || form.inline) found.hooks.push(hookPath);
      merged.set(name, {
        environment: found.environment || form.environment,
        inline: found.inline || form.inline,
        hooks: found.hooks,
      });
    }
  }
  return merged;
}
