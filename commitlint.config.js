/** Conventional Commits. Long body/footer lines and uppercase subjects are allowed. */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'subject-case': [0],
  },
};
