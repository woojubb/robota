/**
 * Conventional-commit enforcement (HARNESS-017).
 * Extends config-conventional; line-length rules are disabled because commit
 * bodies/footers in this repo intentionally include long lines (evidence logs,
 * Co-Authored-By trailers).
 */
import { judgeMessage, pathHasEverExisted } from './scripts/harness/commit-message-claims.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
const gitLines = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

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
          const staged = new Set(gitLines(['diff', '--cached', '--name-only']));
          const findings = judgeMessage(raw ?? '', {
            resolvesObject: (token) => gitLines(['cat-file', '-t', token])[0] === 'commit',
            // History, not the current tree. CI lints every commit of a pull request without
            // checking any of them out, so `--cached` is empty and the tree is always HEAD's.
            pathKnown: (token) => pathHasEverExisted(token, { staged }),
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

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: claimsResolve.plugins,
  rules: {
    ...claimsResolve.rules,
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    // This repo prefixes subjects with uppercase backlog IDs (e.g. "HARNESS-017 — …"),
    // so the default sentence/start/pascal/upper-case ban does not apply.
    'subject-case': [0],
  },
};
