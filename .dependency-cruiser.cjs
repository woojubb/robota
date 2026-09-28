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
    // DAG dependency direction rules
    // dag-core is SSOT - must not depend on any other dag package
    // ==========================================================
    {
      name: 'no-dag-core-to-dag-packages',
      severity: 'error',
      comment: 'dag-core (SSOT) must not depend on any other DAG package',
      from: { path: '^packages/dag-core/' },
      to: {
        path: '^packages/dag-(runtime|worker|projection|api|nodes)/',
      },
    },

    // ==========================================================
    // Lower DAG layers must not depend on higher DAG layers
    // Layer order: dag-core < dag-runtime/dag-worker/dag-projection < dag-api
    // ==========================================================
    {
      name: 'no-dag-runtime-to-api',
      severity: 'error',
      comment: 'dag-runtime must not depend on dag-api (higher layer)',
      from: { path: '^packages/dag-runtime/' },
      to: { path: '^packages/dag-api/' },
    },
    {
      name: 'no-dag-worker-to-api',
      severity: 'error',
      comment: 'dag-worker must not depend on dag-api (higher layer)',
      from: { path: '^packages/dag-worker/' },
      to: { path: '^packages/dag-api/' },
    },
    {
      name: 'no-dag-projection-to-api',
      severity: 'error',
      comment: 'dag-projection must not depend on dag-api (higher layer)',
      from: { path: '^packages/dag-projection/' },
      to: { path: '^packages/dag-api/' },
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
