/**
 * Conventional-commit enforcement (HARNESS-017).
 * Extends config-conventional; line-length rules are disabled because commit
 * bodies/footers in this repo intentionally include long lines (evidence logs,
 * Co-Authored-By trailers).
 */
import {
  judgeMessage,
  objectIsKnown,
  pathHasEverExisted,
  stagedPaths,
} from './scripts/harness/commit-message-claims.mjs';
import { unqualifiedReferences } from './scripts/harness/reference-kind.mjs';

/**
 * A commit message describes the DIFF, not the intent (HARNESS-076).
 *
 * Twice in one session a message asserted something that had not happened — an edit whose script had
 * failed silently, and a commit hash that was typed rather than read. Both were caught by a reader.
 * A message is the record the next person trusts INSTEAD of reading the diff, so a false one does not
 * merely fail to inform: it substitutes for looking.
 *
 * Only the decidable slice is enforced: a commit-ish token must name an object, and a code-spanned
 * repository path must exist in the tree or in this commit. Whether the prose is TRUE is not checked
 * and is not this rule's business.
 *
 * It lives here, not in `.husky/`, because the hook directory is closed to changes by `branch-guard`
 * — and because commitlint is already a REQUIRED status check, so this runs in continuous integration
 * as well as locally, which a hook alone would not.
 */
const claimsResolve = {
  rules: {
    'claims-resolve': [
      2,
      'always',
      // The message as commitlint parsed it; `raw` carries body and footers, which is where the
      // citations live. A rule reading only the subject would check the one line that never has them.
      undefined,
    ],
  },
  plugins: [
    {
      rules: {
        'claims-resolve': ({ raw }) => {
          // `stagedPaths()` rather than a local git call: the copy that stood here swallowed every
          // failure into an empty list, which is the distinction the module it sits beside exists to
          // make — "git could not answer" is not "git answered no". Review found the two disagreeing.
          //
          // LAZY, and once. Eager, it spawned a git subprocess for every commit linted — including
          // the overwhelming majority whose message cites nothing and never asks `pathKnown` at
          // all. Review costed it: this rule runs per commit of a pull request, so an unconditional
          // spawn is a per-commit tax paid mostly for nothing.
          let staged;
          const findings = judgeMessage(raw ?? '', {
            // ANY object, as the rule's own documentation says — a message may cite a tag or a
            // tree, and refusing those would be the check disagreeing with its own description.
            // Ambiguity and a shallow clone are both handled there, in one place, so this side and
            // the path side cannot answer the same question two ways.
            resolvesObject: (token) => objectIsKnown(token),
            // History, not the current tree. CI lints every commit of a pull request without
            // checking any of them out, so `--cached` is empty and the tree is always HEAD's.
            pathKnown: (token) => pathHasEverExisted(token, { staged: (staged ??= stagedPaths()) }),
          });
          if (findings.length === 0) return [true];
          return [
            false,
            findings
              .map((f) => `\`${f.token}\` ${f.detail}`)
              .join('\n  ')
              .concat('\n  Read the tree, then write the message.'),
          ];
        },
      },
    },
  ],
};

/**
 * A `#N` says whether it is an issue or a pull request (INFRA-106).
 *
 * `#1884` and `#1886` are the same six characters and different things — the issue, and the pull
 * request that closed it. `git log --oneline` is where the two are least distinguishable and most
 * often adjacent, so this is the surface where the qualifier earns the most.
 *
 * The predicate and every exemption live in `scripts/harness/reference-kind.mjs`, shared with the
 * tree-side scan. Notably `Closes #N` is exempt: GitHub parses that exact form and INFRA-104 built
 * the promotion machinery that depends on it, so requiring a qualifier there would trade a
 * readability gain for a broken automation.
 *
 * Unlike the tree-side check this needs no ratchet. It judges the message being written, so it is
 * green on arrival by construction and every future commit is held to it — the history it cannot
 * reach is history nobody can rewrite anyway.
 */
const referenceKind = {
  rules: { 'reference-kind': [2, 'always', undefined] },
  plugins: [
    {
      rules: {
        'reference-kind': ({ raw }) => {
          const findings = unqualifiedReferences(raw ?? '');
          if (findings.length === 0) return [true];
          return [
            false,
            findings
              .map((f) => `\`#${f.number}\` does not say whether it is an issue or a pull request`)
              .join('\n  ')
              .concat('\n  Write `issue #N` or `PR #N`. A `Closes #N` footer is exempt.'),
          ];
        },
      },
    },
  ],
};

/**
 * A commit message names its work item and issue, not the agent session that wrote it (RULE-016,
 * issue #2403; `git-branch.md` § Git Operations).
 *
 * The `Claude-Session: https://claude.ai/code/session_…` trailer and the matching footer on PR bodies
 * came from the agent harness's default instructions, not from anyone here: measured on 63ee7f22d,
 * 1105 of 4813 commits carried it and 91 of the last 200 merged PRs carried the footer, for two
 * months before the owner rejected both. A private link in a shared, permanent record — and a
 * default that reasserts itself every session, which is why this is a rule and not a reminder.
 * `Co-Authored-By` is attribution and stays.
 */
const noSessionLink = {
  rules: { 'no-session-link': [2, 'always', undefined] },
  plugins: [
    {
      rules: {
        'no-session-link': ({ raw }) => {
          const text = raw ?? '';
          const carried = [];
          if (/^Claude-Session:/m.test(text)) carried.push('a `Claude-Session:` trailer');
          if (/claude\.ai\/code\/session/.test(text))
            carried.push('an agent-session URL (claude.ai/code/session…)');
          if (carried.length === 0) return [true];
          return [
            false,
            `the message carries ${carried.join(' and ')}. A commit names its work item and issue, ` +
              'not the agent session that wrote it (git-branch.md § Git Operations). `Co-Authored-By` is fine.',
          ];
        },
      },
    },
  ],
};

export default {
  extends: ['@commitlint/config-conventional'],
  // ONE plugin object carrying both rule implementations, not two plugin entries. Measured: with
  // `[...claimsResolve.plugins, ...referenceKind.plugins]` commitlint registered only the LAST
  // entry's rules and then refused the whole config with `Found rules without implementation:
  // claims-resolve` — a config that fails loudly, but only after the second custom rule exists.
  plugins: [
    {
      rules: {
        ...claimsResolve.plugins[0].rules,
        ...referenceKind.plugins[0].rules,
        ...noSessionLink.plugins[0].rules,
      },
    },
  ],
  rules: {
    ...claimsResolve.rules,
    ...referenceKind.rules,
    ...noSessionLink.rules,
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    // This repo prefixes subjects with uppercase backlog IDs (e.g. "HARNESS-017 — …"),
    // so the default sentence/start/pascal/upper-case ban does not apply.
    'subject-case': [0],
  },
};
