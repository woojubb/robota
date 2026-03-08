/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ==========================================================
    // General monorepo rules
    // ==========================================================
    {
      name: "no-circular",
      severity: "warn",
      comment:
        "Circular dependencies detected. Cross-package cycles are critical; " +
        "intra-package cycles should be refactored over time.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-packages-to-apps",
      severity: "error",
      comment: "Packages must not import from apps",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },

    // ==========================================================
    // Core package isolation: agents must not depend on higher-level packages
    // ==========================================================
    {
      name: "no-agents-to-sessions",
      severity: "error",
      comment: "agents (core) must not depend on sessions (higher-level)",
      from: { path: "^packages/agents/" },
      to: { path: "^packages/sessions/" },
    },
    {
      name: "no-agents-to-team",
      severity: "error",
      comment: "agents (core) must not depend on team (higher-level)",
      from: { path: "^packages/agents/" },
      to: { path: "^packages/team/" },
    },
    {
      name: "no-agents-to-remote",
      severity: "error",
      comment: "agents (core) must not depend on remote (higher-level)",
      from: { path: "^packages/agents/" },
      to: { path: "^packages/remote/" },
    },
    {
      name: "no-agents-to-dag",
      severity: "error",
      comment: "agents (core) must not depend on any DAG package",
      from: { path: "^packages/agents/" },
      to: { path: "^packages/dag-" },
    },
    {
      name: "no-agents-to-providers",
      severity: "error",
      comment: "agents (core) must not depend on provider packages",
      from: { path: "^packages/agents/" },
      to: { path: "^packages/(openai|anthropic|google|bytedance)/" },
    },

    // ==========================================================
    // DAG dependency direction rules
    // dag-core is SSOT - must not depend on any other dag package
    // ==========================================================
    {
      name: "no-dag-core-to-dag-packages",
      severity: "error",
      comment: "dag-core (SSOT) must not depend on any other DAG package",
      from: { path: "^packages/dag-core/" },
      to: {
        path: "^packages/dag-(runtime|worker|scheduler|projection|api|designer|nodes|server-core)/",
      },
    },

    // ==========================================================
    // dag-designer must NOT import runtime, worker, or scheduler directly
    // ==========================================================
    {
      name: "no-dag-designer-to-runtime",
      severity: "error",
      comment:
        "dag-designer must not import dag-runtime directly (use dag-api)",
      from: { path: "^packages/dag-designer/" },
      to: { path: "^packages/dag-runtime/" },
    },
    {
      name: "no-dag-designer-to-worker",
      severity: "error",
      comment:
        "dag-designer must not import dag-worker directly (use dag-api)",
      from: { path: "^packages/dag-designer/" },
      to: { path: "^packages/dag-worker/" },
    },
    {
      name: "no-dag-designer-to-scheduler",
      severity: "error",
      comment:
        "dag-designer must not import dag-scheduler directly (use dag-api)",
      from: { path: "^packages/dag-designer/" },
      to: { path: "^packages/dag-scheduler/" },
    },

    // ==========================================================
    // Lower DAG layers must not depend on higher DAG layers
    // Layer order: dag-core < dag-runtime/dag-worker/dag-projection < dag-scheduler < dag-api < dag-designer
    // ==========================================================
    {
      name: "no-dag-runtime-to-scheduler",
      severity: "error",
      comment: "dag-runtime must not depend on dag-scheduler (higher layer)",
      from: { path: "^packages/dag-runtime/" },
      to: { path: "^packages/dag-scheduler/" },
    },
    {
      name: "no-dag-runtime-to-api",
      severity: "error",
      comment: "dag-runtime must not depend on dag-api (higher layer)",
      from: { path: "^packages/dag-runtime/" },
      to: { path: "^packages/dag-api/" },
    },
    {
      name: "no-dag-runtime-to-designer",
      severity: "error",
      comment: "dag-runtime must not depend on dag-designer (higher layer)",
      from: { path: "^packages/dag-runtime/" },
      to: { path: "^packages/dag-designer/" },
    },
    {
      name: "no-dag-worker-to-scheduler",
      severity: "error",
      comment: "dag-worker must not depend on dag-scheduler (higher layer)",
      from: { path: "^packages/dag-worker/" },
      to: { path: "^packages/dag-scheduler/" },
    },
    {
      name: "no-dag-worker-to-api",
      severity: "error",
      comment: "dag-worker must not depend on dag-api (higher layer)",
      from: { path: "^packages/dag-worker/" },
      to: { path: "^packages/dag-api/" },
    },
    {
      name: "no-dag-worker-to-designer",
      severity: "error",
      comment: "dag-worker must not depend on dag-designer (higher layer)",
      from: { path: "^packages/dag-worker/" },
      to: { path: "^packages/dag-designer/" },
    },
    {
      name: "no-dag-projection-to-scheduler",
      severity: "error",
      comment:
        "dag-projection must not depend on dag-scheduler (higher layer)",
      from: { path: "^packages/dag-projection/" },
      to: { path: "^packages/dag-scheduler/" },
    },
    {
      name: "no-dag-projection-to-api",
      severity: "error",
      comment: "dag-projection must not depend on dag-api (higher layer)",
      from: { path: "^packages/dag-projection/" },
      to: { path: "^packages/dag-api/" },
    },
    {
      name: "no-dag-projection-to-designer",
      severity: "error",
      comment: "dag-projection must not depend on dag-designer (higher layer)",
      from: { path: "^packages/dag-projection/" },
      to: { path: "^packages/dag-designer/" },
    },
    {
      name: "no-dag-scheduler-to-api",
      severity: "error",
      comment: "dag-scheduler must not depend on dag-api (higher layer)",
      from: { path: "^packages/dag-scheduler/" },
      to: { path: "^packages/dag-api/" },
    },
    {
      name: "no-dag-scheduler-to-designer",
      severity: "error",
      comment: "dag-scheduler must not depend on dag-designer (higher layer)",
      from: { path: "^packages/dag-scheduler/" },
      to: { path: "^packages/dag-designer/" },
    },
    {
      name: "no-dag-api-to-designer",
      severity: "error",
      comment: "dag-api must not depend on dag-designer (higher layer)",
      from: { path: "^packages/dag-api/" },
      to: { path: "^packages/dag-designer/" },
    },

    // ==========================================================
    // Provider packages must not depend on each other
    // ==========================================================
    {
      name: "no-provider-cross-deps",
      severity: "error",
      comment: "Provider packages must not depend on each other",
      from: { path: "^packages/(openai|anthropic|google|bytedance)/" },
      to: {
        path: "^packages/(openai|anthropic|google|bytedance)/",
        pathNot: "$1",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
    exclude: {
      path: [
        "node_modules",
        "\\.test\\.",
        "\\.spec\\.",
        "__tests__",
        "__mocks__",
        "dist/",
      ],
    },
  },
};
