/**
 * Package-local ESLint config
 *
 * Why this exists:
 * - In this monorepo, `pnpm -r run lint` executes `eslint` with the package as CWD.
 * - The root `.eslintrc.json` uses relative `parserOptions.project` paths intended for repo-root execution.
 * - When executed from a package directory, those paths don't resolve to the correct TSConfig files.
 *
 * Fix:
 * - Pin `tsconfigRootDir` to this package directory and include both tsconfigs.
 * - This prevents "TSConfig does not include this file" parsing errors for `__tests__` files.
 */

module.exports = {
  extends: ['../../.eslintrc.json'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json', './tsconfig.test.json'],
  },
};
