/** Single ESLint config for the monorepo. Packages inherit it; only apps with a different product type override it. */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: ['eslint:recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'eslint-comments', 'jsx-a11y'],
  globals: {
    NodeJS: 'readonly',
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/ban-types': [
      'warn',
      {
        types: {
          any: '❌ Avoid `any` in shipped source. Prefer specific types/SSOT types, and validate external inputs. Note: disabling no-explicit-any in src/ is prohibited; tests are exempt.',
          '{}': false,
        },
        extendDefaults: true,
      },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        destructuredArrayIgnorePattern: '^_',
      },
    ],
    'no-unused-vars': 'off',
    'no-dupe-class-members': 'off',
    '@typescript-eslint/no-dupe-class-members': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/ban-ts-comment': 'error',
    'no-useless-catch': 'warn',
    'no-console': 'error',
    'no-redeclare': 'error',
    'no-case-declarations': 'off',
    'no-restricted-syntax': [
      'error',
      {
        selector: "AwaitExpression[argument.type='ImportExpression']",
        message:
          "❌ PROHIBITED: Dynamic imports with 'await import()' are forbidden. Use standard top-level imports at the beginning of the file instead.",
      },
      {
        selector: 'ImportExpression',
        message:
          "❌ PROHIBITED: Dynamic imports with 'import()' are forbidden except for truly conditional optional modules. Use standard top-level imports at the beginning of the file instead.",
      },
      {
        selector:
          "CallExpression[callee.property.name='emit'][callee.object.name='eventService'][arguments.0.type='Literal']",
        message:
          '❌ PROHIBITED: Hardcoded event name in eventService.emit(). Import event constants from the owning module.',
      },
      {
        selector:
          "CallExpression[callee.property.name='emit'][callee.object.property.name='eventService'][arguments.0.type='Literal']",
        message:
          '❌ PROHIBITED: Hardcoded event name in this.eventService.emit(). Import event constants from the owning module.',
      },
      {
        selector:
          "CallExpression[callee.property.name=/^(on|once|off)$/][callee.object.name='eventService'][arguments.0.type='Literal']",
        message:
          '❌ PROHIBITED: Hardcoded event name in eventService subscription. Import event constants from the owning module.',
      },
      {
        selector:
          "CallExpression[callee.property.name=/^(on|once|off)$/][callee.object.property.name='eventService'][arguments.0.type='Literal']",
        message:
          '❌ PROHIBITED: Hardcoded event name in this.eventService subscription. Import event constants from the owning module.',
      },
    ],
    '@typescript-eslint/no-require-imports': 'error',
    'no-param-reassign': [
      'error',
      {
        props: false,
      },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
        disallowTypeAnnotations: false,
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      rules: {
        'no-undef': 'off',
      },
    },
    {
      files: ['packages/*/src/**/*', 'apps/*/src/**/*'],
      rules: {
        'eslint-comments/no-restricted-disable': [
          'error',
          '@typescript-eslint/no-explicit-any',
          '@typescript-eslint/ban-types',
        ],
      },
    },
    {
      files: ['apps/**/*'],
      rules: {
        'no-console': 'off',
        'no-restricted-syntax': 'off',
        '@typescript-eslint/no-unused-vars': [
          'warn',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            ignoreRestSiblings: true,
            destructuredArrayIgnorePattern: '^_',
          },
        ],
        'no-unused-vars': 'off',
      },
    },
    {
      files: ['apps/examples/**/*', 'examples/**/*'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-unused-vars': [
          'warn',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            ignoreRestSiblings: true,
            destructuredArrayIgnorePattern: '^_',
          },
        ],
        'no-unused-vars': 'off',
      },
    },
    {
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.bintest.ts',
        '**/__tests__/fixtures/**/*.{js,mjs,cjs}',
      ],
      env: {
        jest: true,
      },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
      rules: {
        'eslint-comments/no-restricted-disable': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'no-unused-vars': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/ban-types': 'off',
        'no-console': 'warn',
        complexity: 'off',
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'no-magic-numbers': 'off',
        'no-restricted-syntax': 'off',
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
    {
      files: [
        '**/*.config.js',
        '**/*.config.ts',
        '**/webpack.config.js',
        '**/vite.config.ts',
        '**/rollup.config.js',
      ],
      rules: {
        'no-restricted-syntax': 'off',
        'no-magic-numbers': 'off',
        'max-lines': 'off',
      },
    },
    {
      files: ['packages/playground/**/*.{ts,tsx,js,jsx}', 'apps/agent-web/**/*.{ts,tsx,js,jsx}'],
      extends: ['plugin:jsx-a11y/recommended'],
      rules: {
        'jsx-a11y/alt-text': 'warn',
        'jsx-a11y/anchor-has-content': 'warn',
        'jsx-a11y/anchor-is-valid': 'warn',
        'jsx-a11y/aria-activedescendant-has-tabindex': 'warn',
        'jsx-a11y/aria-props': 'warn',
        'jsx-a11y/aria-proptypes': 'warn',
        'jsx-a11y/aria-role': 'warn',
        'jsx-a11y/aria-unsupported-elements': 'warn',
        'jsx-a11y/autocomplete-valid': 'warn',
        'jsx-a11y/click-events-have-key-events': 'warn',
        'jsx-a11y/heading-has-content': 'warn',
        'jsx-a11y/html-has-lang': 'warn',
        'jsx-a11y/iframe-has-title': 'warn',
        'jsx-a11y/img-redundant-alt': 'warn',
        'jsx-a11y/interactive-supports-focus': 'warn',
        'jsx-a11y/label-has-associated-control': 'warn',
        'jsx-a11y/media-has-caption': 'warn',
        'jsx-a11y/mouse-events-have-key-events': 'warn',
        'jsx-a11y/no-access-key': 'warn',
        'jsx-a11y/no-autofocus': 'warn',
        'jsx-a11y/no-distracting-elements': 'warn',
        'jsx-a11y/no-interactive-element-to-noninteractive-role': 'warn',
        'jsx-a11y/no-noninteractive-element-interactions': 'warn',
        'jsx-a11y/no-noninteractive-element-to-interactive-role': 'warn',
        'jsx-a11y/no-noninteractive-tabindex': 'warn',
        'jsx-a11y/no-redundant-roles': 'warn',
        'jsx-a11y/no-static-element-interactions': 'warn',
        'jsx-a11y/role-has-required-aria-props': 'warn',
        'jsx-a11y/role-supports-aria-props': 'warn',
        'jsx-a11y/scope': 'warn',
        'jsx-a11y/tabindex-no-positive': 'warn',
      },
    },
    {
      files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
      excludedFiles: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
      rules: {},
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      rules: {
        '@typescript-eslint/consistent-type-imports': 'off',
      },
    },
    {
      files: ['packages/**/*.ts', 'packages/**/*.tsx', 'apps/agent-server/**/*.ts'],
      excludedFiles: ['**/*.d.ts'],
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: [
          './packages/*/tsconfig.eslint.json',
          './packages/dag-nodes/*/tsconfig.eslint.json',
          './apps/agent-server/tsconfig.eslint.json',
        ],
      },
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
      },
    },
  ],
  ignorePatterns: [
    'website/**/*',
    'backup/**/*',
    'docs/**/*',
    'apps/docs/**/*',
    'apps/agent-web/**/*',
    '**/*.d.ts',
    'dist',
    'node_modules',
    'scripts/**/*',
    '**/jest.setup.js',
    '**/jest.config.js',
    '**/.eslintrc.cjs',
    'vitest.setup.ts',
    '**/vitest.setup.ts',
    'packages/*/examples/**/*',
  ],
};
