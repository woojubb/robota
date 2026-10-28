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
