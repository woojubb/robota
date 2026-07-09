#!/usr/bin/env node

/**
 * Check repository-wide capability placement guardrails.
 *
 * The scan keeps product shells thin by catching durable behavior ownership
 * that belongs in SDK/runtime/command/provider/service packages.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadHarnessConfig } from './harness-config.mjs';

const WORKSPACE_ROOT = process.cwd();

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const PRODUCT_SHELL_DIRS = loadHarnessConfig().productShellDirs;
const PROJECT_STRUCTURE_PATH = '.agents/project-structure.md';

const PRODUCT_SHELL_OWNERSHIP_PATTERNS = [
  {
    type: 'product-shell-background-registry',
    pattern: /\b(?:class|interface|type|const)\s+\w*(?:BackgroundTaskRegistry|TaskRegistry)\b/,
    detail: 'Product shells must not own durable background task registries.',
  },
  {
    type: 'product-shell-lifecycle-state-machine',
    pattern: /\b(?:class|interface|type|const)\s+\w*(?:LifecycleStateMachine|TransitionTable)\b/,
    detail: 'Lifecycle state machines belong in runtime or another lower reusable owner.',
  },
  {
    type: 'product-shell-retention-policy',
    pattern: /\b(?:class|interface|type|const)\s+\w*RetentionPolicy\b/,
    detail: 'Retention policy belongs in SDK/runtime owner contracts, not product shells.',
  },
  {
    type: 'product-shell-provider-catalog',
    pattern: /\b(?:class|interface|type|const)\s+\w*(?:ProviderModelCatalog|ModelCatalog)\b/,
    detail: 'Provider model catalogs belong in provider packages through core contracts.',
  },
  {
    type: 'product-shell-permission-policy',
    pattern: /\b(?:class|interface|type|const)\s+\w*PermissionPolicy\b/,
    detail: 'Permission policy belongs in owner contracts below the product shell.',
  },
  {
    type: 'product-shell-command-descriptor-registry',
    pattern: /\b(?:class|interface|type|const)\s+\w*CommandDescriptorRegistry\b/,
    detail: 'Command descriptor semantics belong in command/SDK contracts.',
  },
];

const COMMAND_PACKAGE_FORBIDDEN_DEPENDENCY_PREFIXES = [
  '@robota-sdk/agent-provider-',
  '@robota-sdk/agent-cli',
  '@robota-sdk/agent-web-ui',
  '@robota-sdk/agent-server',
];

const PROVIDER_PACKAGE_FORBIDDEN_DEPENDENCY_PREFIXES = [
  '@robota-sdk/agent-command-',
  '@robota-sdk/agent-cli',
  '@robota-sdk/agent-web-ui',
  '@robota-sdk/agent-server',
  '@robota-sdk/agent-framework',
];

const DOCUMENTED_WORKSPACE_PATTERNS = [
  { pathPattern: /^packages\/agent-command$/, textPattern: /agent-command\// },
  { pathPattern: /^packages\/agent-command-[^/]+$/, textPattern: /agent-command-\*/ },
  { pathPattern: /^packages\/agent-provider$/, textPattern: /agent-provider\// },
  { pathPattern: /^packages\/agent-provider-[^/]+$/, textPattern: /agent-provider-\*/ },
  { pathPattern: /^packages\/agent-transport$/, textPattern: /agent-transport\// },
  { pathPattern: /^packages\/agent-transport-[^/]+$/, textPattern: /agent-transport-\*/ },
  { pathPattern: /^packages\/agent-testing$/, textPattern: /agent-testing/ },
  { pathPattern: /^packages\/agent-plugin$/, textPattern: /agent-plugin\// },
  { pathPattern: /^packages\/agent-plugin-[^/]+$/, textPattern: /agent-plugin-\*/ },
  { pathPattern: /^packages\/agent-interface-[^/]+$/, textPattern: /agent-interface-\*/ },
  { pathPattern: /^packages\/agent-web-ui$/, textPattern: /agent-web-ui/ },
  { pathPattern: /^packages\/agent-tool-mcp$/, textPattern: /agent-tool-mcp/ },
  { pathPattern: /^packages\/agent-tools$/, textPattern: /agent-tools/ },
  { pathPattern: /^packages\/agent-process$/, textPattern: /agent-process/ },
  { pathPattern: /^packages\/agent-executor$/, textPattern: /agent-executor/ },
  { pathPattern: /^packages\/agent-framework$/, textPattern: /agent-framework/ },
  { pathPattern: /^packages\/agent-preset$/, textPattern: /agent-preset/ },
  { pathPattern: /^packages\/agent-session$/, textPattern: /agent-session/ },
  {
    pathPattern: /^packages\/agent-session-analytics$/,
    textPattern: /agent-session-analytics/,
  },
  { pathPattern: /^packages\/agent-core$/, textPattern: /agent-core/ },
  { pathPattern: /^packages\/agent-cli$/, textPattern: /agent-cli/ },
  { pathPattern: /^packages\/agent-playground$/, textPattern: /agent-playground/ },
  { pathPattern: /^packages\/agent-remote-client$/, textPattern: /agent-remote-client/ },
  { pathPattern: /^packages\/agent-team$/, textPattern: /agent-team/ },
  { pathPattern: /^packages\/agent-subagent-runner$/, textPattern: /agent-subagent-runner/ },
  { pathPattern: /^packages\/agent-event-service$/, textPattern: /agent-event-service/ },
  // DAG subsystem (WORKFLOW-001): top-level engine/surface packages + node-family packages.
  { pathPattern: /^packages\/dag-[^/]+$/, textPattern: /dag-core\// },
  { pathPattern: /^packages\/dag-nodes\/[^/]+$/, textPattern: /dag-nodes\/\*/ },
  { pathPattern: /^apps\/agent-web$/, textPattern: /agent-web/ },
  { pathPattern: /^apps\/agent-server$/, textPattern: /agent-server/ },
  { pathPattern: /^apps\/dag-runtime-server$/, textPattern: /dag-runtime-server/ },
  { pathPattern: /^apps\/remote-signaling$/, textPattern: /remote-signaling/ },
  { pathPattern: /^apps\/docs$/, textPattern: /(?:apps\/)?docs\// },
  { pathPattern: /^apps\/blog$/, textPattern: /(?:apps\/)?blog\// },
  { pathPattern: /^apps\/action$/, textPattern: /(?:apps\/)?action\// },
  { pathPattern: /^apps\/starter-nextjs$/, textPattern: /starter-nextjs\// },
  { pathPattern: /^apps\/www$/, textPattern: /(?:apps\/)?www\// },
];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isSourceFile(relativePath) {
  return SOURCE_EXTENSIONS.has(path.extname(relativePath));
}

function isIgnoredPath(relativePath) {
  return (
    relativePath.includes('/node_modules/') ||
    relativePath.includes('/dist/') ||
    relativePath.includes('/coverage/') ||
    relativePath.includes('/__tests__/') ||
    /\.test\.[cm]?[jt]sx?$/.test(relativePath) ||
    /\.spec\.[cm]?[jt]sx?$/.test(relativePath)
  );
}

async function walkFiles(root, relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!(await pathExists(absoluteDir))) {
    return [];
  }

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelativePath = path.join(relativeDir, entry.name);
    if (isIgnoredPath(childRelativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, childRelativePath)));
      continue;
    }
    if (entry.isFile() && isSourceFile(childRelativePath)) {
      files.push(childRelativePath);
    }
  }
  return files;
}

async function readJsonFile(root, relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
}

async function listWorkspacePackages(root) {
  const packages = new Map();
  for (const workspaceDir of ['apps', 'packages']) {
    const absoluteDir = path.join(root, workspaceDir);
    if (!(await pathExists(absoluteDir))) {
      continue;
    }

    for (const entry of await fs.readdir(absoluteDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const relativeDir = path.join(workspaceDir, entry.name);
      const packageJsonPath = path.join(relativeDir, 'package.json');
      if (!(await pathExists(path.join(root, packageJsonPath)))) {
        continue;
      }
      const packageJson = await readJsonFile(root, packageJsonPath);
      packages.set(packageJson.name, {
        name: packageJson.name,
        relativeDir,
        packageJson,
      });
    }
  }
  return packages;
}

function listAllDependencies(packageJson) {
  return Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  });
}

function extractRobotaImports(content) {
  const imports = new Set();
  const importPattern =
    /(?:from\s+['"](@robota-sdk\/[^'"]+)['"]|import\s*\(\s*['"](@robota-sdk\/[^'"]+)['"]\s*\))/g;
  let match;
  while ((match = importPattern.exec(content)) !== null) {
    imports.add(match[1] ?? match[2]);
  }
  return [...imports];
}

function getWorkspacePackageName(importSpecifier) {
  const [scope, packageName] = importSpecifier.split('/');
  if (scope !== '@robota-sdk' || !packageName) {
    return undefined;
  }
  return `${scope}/${packageName}`;
}

function getPackageSubpath(importSpecifier) {
  const parts = importSpecifier.split('/');
  if (parts.length <= 2) {
    return '.';
  }
  return `./${parts.slice(2).join('/')}`;
}

function packageExportsSubpath(packageJson, subpath) {
  if (subpath === '.') {
    return true;
  }
  const exportsField = packageJson.exports;
  if (typeof exportsField === 'string') {
    return false;
  }
  if (exportsField && typeof exportsField === 'object') {
    return Object.prototype.hasOwnProperty.call(exportsField, subpath);
  }
  return false;
}

async function findProductShellFindings(root, packages) {
  const findings = [];

  for (const productShellDir of PRODUCT_SHELL_DIRS) {
    for (const file of await walkFiles(root, productShellDir)) {
      const content = await fs.readFile(path.join(root, file), 'utf8');

      for (const check of PRODUCT_SHELL_OWNERSHIP_PATTERNS) {
        if (!check.pattern.test(content)) {
          continue;
        }
        findings.push({
          file,
          type: check.type,
          detail: check.detail,
        });
      }

      for (const importSpecifier of extractRobotaImports(content)) {
        const packageName = getWorkspacePackageName(importSpecifier);
        if (!packageName) {
          continue;
        }
        const workspacePackage = packages.get(packageName);
        if (!workspacePackage) {
          continue;
        }

        const specPath = path.join(workspacePackage.relativeDir, 'docs', 'SPEC.md');
        if (!(await pathExists(path.join(root, specPath)))) {
          findings.push({
            file,
            type: 'composition-root-import-missing-owner-spec',
            detail: `${importSpecifier} is used from a product shell but ${specPath} does not exist.`,
          });
        }

        const subpath = getPackageSubpath(importSpecifier);
        if (subpath.includes('/src') || subpath.includes('/dist')) {
          findings.push({
            file,
            type: 'product-shell-internal-import',
            detail: `${importSpecifier} reaches into implementation internals; import the owner package public API instead.`,
          });
          continue;
        }

        if (!packageExportsSubpath(workspacePackage.packageJson, subpath)) {
          findings.push({
            file,
            type: 'composition-root-import-unexported-subpath',
            detail: `${importSpecifier} is not an exported owner package entry.`,
          });
        }
      }
    }
  }

  return findings;
}

async function findPackageDependencyFindings(packages) {
  const findings = [];

  for (const workspacePackage of packages.values()) {
    const dependencies = listAllDependencies(workspacePackage.packageJson);
    const packageJsonPath = path.join(workspacePackage.relativeDir, 'package.json');

    const isCommandPackage =
      workspacePackage.relativeDir === 'packages/agent-command' ||
      workspacePackage.relativeDir.startsWith('packages/agent-command-');
    if (isCommandPackage) {
      // Production deps only: the rule keeps command packages from *shipping* provider
      // implementations. A test-only devDependency (e.g. a `.live.test.ts` importing
      // `agent-provider-defaults` for default provider definitions) is not a runtime layering
      // violation (ARCH-PROVIDER-002). Layering, like dependency-direction, is production-scoped.
      const productionDependencies = Object.keys(workspacePackage.packageJson.dependencies ?? {});
      for (const dependency of productionDependencies) {
        if (
          !COMMAND_PACKAGE_FORBIDDEN_DEPENDENCY_PREFIXES.some((prefix) =>
            dependency.startsWith(prefix),
          )
        ) {
          continue;
        }
        findings.push({
          file: packageJsonPath,
          type: 'command-package-forbidden-dependency',
          detail: `Command packages must not depend on ${dependency}; keep command behavior below product shells and separate from provider implementations.`,
        });
      }
    }

    const isProviderPackage =
      workspacePackage.relativeDir === 'packages/agent-provider' ||
      workspacePackage.relativeDir.startsWith('packages/agent-provider-');
    if (isProviderPackage) {
      for (const dependency of dependencies) {
        if (
          !PROVIDER_PACKAGE_FORBIDDEN_DEPENDENCY_PREFIXES.some((prefix) =>
            dependency.startsWith(prefix),
          )
        ) {
          continue;
        }
        findings.push({
          file: packageJsonPath,
          type: 'provider-package-forbidden-dependency',
          detail: `Provider packages must not depend on ${dependency}; provider behavior should use core contracts and provider-family helpers only.`,
        });
      }
    }
  }

  return findings;
}

async function findProjectStructureFindings(root, packages) {
  const findings = [];
  const projectStructurePath = path.join(root, PROJECT_STRUCTURE_PATH);
  if (!(await pathExists(projectStructurePath))) {
    return [
      {
        file: PROJECT_STRUCTURE_PATH,
        type: 'missing-project-structure',
        detail: 'Project structure document is required for workspace capability placement.',
      },
    ];
  }

  const projectStructure = await fs.readFile(projectStructurePath, 'utf8');
  for (const workspacePackage of packages.values()) {
    const documented = DOCUMENTED_WORKSPACE_PATTERNS.some(
      (entry) =>
        entry.pathPattern.test(workspacePackage.relativeDir) &&
        entry.textPattern.test(projectStructure),
    );

    if (!documented) {
      findings.push({
        file: PROJECT_STRUCTURE_PATH,
        type: 'workspace-package-not-documented',
        detail: `${workspacePackage.relativeDir} is not covered by project-structure package family rules.`,
      });
    }
  }

  return findings;
}

export async function findCapabilityPlacementFindings(root = WORKSPACE_ROOT) {
  const packages = await listWorkspacePackages(root);
  return [
    ...(await findProductShellFindings(root, packages)),
    ...(await findPackageDependencyFindings(packages)),
    ...(await findProjectStructureFindings(root, packages)),
  ];
}

export async function main() {
  const findings = await findCapabilityPlacementFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('capability placement scan passed.\n');
    return;
  }

  process.stdout.write('capability placement scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
