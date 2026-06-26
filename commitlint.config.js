/**
 * Conventional-commit enforcement (HARNESS-017).
 * Extends config-conventional; line-length rules are disabled because commit
 * bodies/footers in this repo intentionally include long lines (evidence logs,
 * Co-Authored-By trailers).
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    // This repo prefixes subjects with uppercase backlog IDs (e.g. "HARNESS-017 — …"),
    // so the default sentence/start/pascal/upper-case ban does not apply.
    'subject-case': [0],
  },
};
