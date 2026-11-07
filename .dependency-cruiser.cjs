/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ==========================================================
    // General monorepo rules
    // ==========================================================
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies detected. Cross-package cycles are critical; ' +
        'intra-package cycles should be refactored over time.',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-packages-to-apps',
      severity: 'error',
      comment: 'Packages must not import from apps',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },

    // ==========================================================
    // Provider packages must not depend on each other
    // ==========================================================
    {
      name: 'no-provider-cross-deps',
      severity: 'error',
      comment: 'A provider package must not depend on another provider package (FAMILY-SIBLINGS).',
      from: {
        path: '^packages/agent-provider-([^/]+)/',
        pathNot: '^packages/agent-provider-openai/',
      },
      to: { path: '^packages/agent-provider-', pathNot: '^packages/agent-provider-$1/' },
    },
    {
      name: 'no-openai-provider-cross-deps',
      severity: 'error',
      comment:
        'agent-provider-openai may use the OpenAI wire-protocol base in agent-provider-openai-compatible ' +
        'and no other provider package (FAMILY-SIBLINGS exception).',
      from: { path: '^packages/agent-provider-openai/' },
      to: {
        path: '^packages/agent-provider-',
        pathNot: '^packages/agent-provider-(openai|openai-compatible)/',
      },
    },

    // ==========================================================
    // Secure conversations (#3679 3f, decided design change 5)
    // ==========================================================
    {
      name: 'user-read-request-mint',
      severity: 'error',
      comment:
        'Only a read the person started may ask for the passphrase, and only the terminal UI action ' +
        'modules listed here may say so: nothing else imports the mint, so no command or tool the ' +
        'model can run can open the prompt. A new importer is a reviewed edit of this list.',
      from: {
        pathNot: '^packages/agent-ui-terminal/src/hooks/useForkAttach\\.ts$',
      },
      to: { path: '^packages/agent-ui-terminal/src/key-custody/user-read-request-mint\\.ts$' },
    },
    {
      name: 'user-read-request-record',
      severity: 'error',
      comment:
        'The record of minted requests is the runtime check behind the mint rule: only the mint adds ' +
        'to it and only the port guard reads it, so nothing else can make a request the holder accepts.',
      from: {
        pathNot:
          '^packages/agent-ui-terminal/src/key-custody/(user-read-request-mint|key-custody-port)\\.ts$',
      },
      to: { path: '^packages/agent-ui-terminal/src/key-custody/minted-read-requests\\.ts$' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['source', 'import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
    exclude: {
      path: ['node_modules', '\\.test\\.', '\\.spec\\.', '__tests__', '__mocks__', 'dist/'],
    },
  },
};
