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
    // agent-provider: importing one vendor subpath never loads another vendor
    // ==========================================================
    {
      name: 'provider-vendors-are-isolated',
      severity: 'error',
      comment:
        'A vendor subpath of agent-provider imports no other vendor subpath, so a consumer that imports one ' +
        'vendor never bundles another vendor or its SDK. Only the OpenAI-compatible base is shared (below), ' +
        'google is the alias of gemini, and builtin composes the others.',
      from: { path: '^packages/agent-provider/src/(anthropic|bytedance|gemini|openai-compatible)/' },
      to: {
        path: '^packages/agent-provider/src/(anthropic|bytedance|gemini|google|openai|deepseek|qwen|gemma|openai-compatible|builtin)/',
        pathNot: '^packages/agent-provider/src/$1/',
      },
    },
    {
      name: 'provider-openai-family-shares-only-the-base',
      severity: 'error',
      comment:
        'openai, deepseek, qwen and gemma build on the OpenAI-compatible protocol base and import no other vendor.',
      from: { path: '^packages/agent-provider/src/(openai|deepseek|qwen|gemma)/' },
      to: {
        path: '^packages/agent-provider/src/(anthropic|bytedance|gemini|google|openai|deepseek|qwen|gemma|builtin)/',
        pathNot: '^packages/agent-provider/src/$1/',
      },
    },
    {
      name: 'provider-google-alias-imports-only-gemini',
      severity: 'error',
      comment: 'The google subpath is the deprecated alias of gemini and imports nothing else.',
      from: { path: '^packages/agent-provider/src/google/' },
      to: {
        path: '^packages/agent-provider/src/(anthropic|bytedance|openai|deepseek|qwen|gemma|openai-compatible|builtin)/',
      },
    },

    // ==========================================================
    // Secure conversations
    // ==========================================================
    {
      name: 'user-read-request-mint',
      severity: 'error',
      comment:
        'Only a read the person started may ask for the passphrase, and only the terminal UI action ' +
        'modules listed here may say so: nothing else imports the mint, so no command or tool the ' +
        'model can run can open the prompt. A new importer is a reviewed edit of this list.',
      from: {
        pathNot: '^packages/agent-ui-terminal/src/hooks/(useForkAttach|useFollowHistory)\\.ts$',
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
