/**
 * gate.mjs's command-line argument parsing — the CLI surface alone, no gate evaluation.
 *
 * Split out of `gate-operations.mjs` when HARNESS-2661 added the per-subcommand flag sets: the
 * evaluator file is at its file-size baseline, and `code-quality.md`'s anti-monolith rule says
 * frozen debt may shrink but never grow, so the parser moved rather than the ceiling. Approval and
 * gate JUDGEMENT logic deliberately stayed behind in `gate-operations.mjs`, which
 * `scan-gate-evaluator-isolation` watches as an evaluator path.
 */

/**
 * The flags each subcommand READS, and therefore the only ones it accepts (HARNESS-2661).
 *
 * An argument a command ignores is a silent pass over the thing the caller asked for —
 * `new-spec.mjs` already refuses one (HARNESS-095) and this parser did not, so `judge --rule`
 * (read by `advance` alone) and every misspelling were stored and dropped without a word.
 *
 * Each set is derived from the `options.<key>` reads of that subcommand's entry point AND of the
 * helpers it delegates to: `--rule` is `prepareAdvance`'s, `--continuation`/`--correction` are
 * `gate-implementation-contract`'s, `--date` is `today()`'s. Add a flag here in the same commit
 * that adds the read, or the CLI refuses the flag its own code expects.
 */
const SUBCOMMAND_FLAGS = Object.freeze({
  judge: Object.freeze([
    'backlog-rule',
    'catalogue',
    'continuation',
    'correction',
    'date',
    'doc',
    'dry-run',
    'gate',
    'lane',
    'root',
    'verify-cmd',
  ]),
  record: Object.freeze(['command', 'date', 'doc', 'exit', 'output-file', 'root', 'skip', 'tc']),
  advance: Object.freeze(['doc', 'root', 'rule']),
  approve: Object.freeze([
    'backlog-rule',
    'catalogue',
    'class',
    'conversation',
    'date',
    'doc',
    'evidence',
    'given',
    'instruction',
    'root',
    'route',
  ]),
});

export function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  // An unrecognised subcommand has no set to judge against; gate-cli reports it by name instead.
  const known = Object.hasOwn(SUBCOMMAND_FLAGS, subcommand) ? SUBCOMMAND_FLAGS[subcommand] : null;
  const options = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (known && !known.includes(key))
      throw new Error(
        `--${key} is not a flag \`${subcommand}\` uses — accepting it would drop it silently. ` +
          `\`${subcommand}\` accepts: ${known.map((flag) => `--${flag}`).join(', ')}`,
      );
    const flagOnly = key === 'dry-run' || key === 'continuation' || key === 'correction';
    if (flagOnly) {
      options[key] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    i += 1;
    if (key === 'verify-cmd') {
      options['verify-cmd'] = [...(options['verify-cmd'] ?? []), value];
    } else {
      options[key] = value;
    }
  }
  return { subcommand, options };
}
