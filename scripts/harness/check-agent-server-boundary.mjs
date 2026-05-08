#!/usr/bin/env node

/**
 * Check the browser/server/playground/remote-client boundary for remote execution.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

const PACKAGE_CHECKS = [
  {
    file: 'apps/agent-web/package.json',
    forbiddenPrefixes: [
      '@robota-sdk/agent-provider-',
      '@robota-sdk/agent-server',
      '@robota-sdk/agent-remote-client',
    ],
    type: 'agent-web-forbidden-dependency',
    detail:
      'agent-web must stay a browser host; provider, server, and remote protocol behavior belongs below the app shell.',
  },
  {
    file: 'apps/agent-server/package.json',
    forbiddenPrefixes: [
      '@robota-sdk/agent-web',
      '@robota-sdk/agent-cli',
      '@robota-sdk/agent-remote-client',
    ],
    type: 'agent-server-forbidden-dependency',
    detail:
      'agent-server must stay a server composition root and must not depend on browser hosts, CLI shells, or remote clients.',
  },
  {
    file: 'packages/agent-remote-client/package.json',
    forbiddenPrefixes: [
      '@robota-sdk/agent-provider-',
      '@robota-sdk/agent-server',
      '@robota-sdk/agent-web',
      '@robota-sdk/agent-playground',
    ],
    type: 'remote-client-forbidden-dependency',
    detail:
      'agent-remote-client owns transport client behavior and must not depend on providers, hosts, or Playground UI.',
  },
];

const REQUIRED_PACKAGE_DEPENDENCIES = [
  {
    file: 'apps/agent-server/package.json',
    dependencyPattern: /^@robota-sdk\/agent-provider-/,
    type: 'agent-server-missing-provider-composition',
    detail: 'agent-server should remain the provider-side composition root for remote execution.',
  },
  {
    file: 'packages/agent-playground/package.json',
    dependencyPattern: /^@robota-sdk\/agent-remote-client$/,
    type: 'agent-playground-missing-remote-client-dependency',
    detail:
      'agent-playground should compose reusable browser execution through agent-remote-client.',
  },
];

const SOURCE_IMPORT_CHECKS = [
  {
    dir: 'apps/agent-web/src',
    forbiddenImport(specifier) {
      return (
        specifier.startsWith('@robota-sdk/agent-provider-') ||
        specifier === '@robota-sdk/agent-server' ||
        specifier.startsWith('@robota-sdk/agent-server/') ||
        specifier === '@robota-sdk/agent-remote-client' ||
        specifier.startsWith('@robota-sdk/agent-remote-client/') ||
        specifier === '@robota-sdk/agent-playground' ||
        (specifier.startsWith('@robota-sdk/agent-playground/') &&
          specifier !== '@robota-sdk/agent-playground/client')
      );
    },
    type: 'agent-web-forbidden-import',
    detail:
      'agent-web must import only browser-safe Playground entries and must not call providers/server/remote protocol packages directly.',
  },
  {
    dir: 'apps/agent-server/src',
    forbiddenImport(specifier) {
      return (
        specifier === '@robota-sdk/agent-web' ||
        specifier.startsWith('@robota-sdk/agent-web/') ||
        specifier === '@robota-sdk/agent-cli' ||
        specifier.startsWith('@robota-sdk/agent-cli/') ||
        specifier === '@robota-sdk/agent-remote-client' ||
        specifier.startsWith('@robota-sdk/agent-remote-client/') ||
        specifier === '@robota-sdk/agent-playground/client' ||
        specifier.startsWith('@robota-sdk/agent-playground/client/')
      );
    },
    type: 'agent-server-forbidden-import',
    detail:
      'agent-server may compose provider proxying and WebSocket hosting, but must not import browser hosts or remote clients.',
  },
  {
    dir: 'packages/agent-remote-client/src',
    forbiddenImport(specifier) {
      return (
        specifier.startsWith('@robota-sdk/agent-provider-') ||
        specifier === '@robota-sdk/agent-server' ||
        specifier.startsWith('@robota-sdk/agent-server/') ||
        specifier === '@robota-sdk/agent-web' ||
        specifier.startsWith('@robota-sdk/agent-web/') ||
        specifier === '@robota-sdk/agent-playground' ||
        specifier.startsWith('@robota-sdk/agent-playground/')
      );
    },
    type: 'remote-client-forbidden-import',
    detail: 'agent-remote-client must remain a UI-agnostic transport client over core contracts.',
  },
  {
    dir: 'packages/agent-playground/src',
    forbiddenImport(specifier) {
      return (
        specifier === '@robota-sdk/agent-server' ||
        specifier.startsWith('@robota-sdk/agent-server/') ||
        specifier === '@robota-sdk/agent-web' ||
        specifier.startsWith('@robota-sdk/agent-web/')
      );
    },
    type: 'agent-playground-forbidden-import',
    detail:
      'agent-playground owns reusable Playground behavior and must not import deployment hosts.',
  },
];

const REQUIRED_SOURCE_IMPORTS = [
  {
    dir: 'apps/agent-web/src',
    importSpecifier: '@robota-sdk/agent-playground/client',
    type: 'agent-web-missing-browser-safe-playground-import',
    detail:
      'agent-web should render Playground through the browser-safe @robota-sdk/agent-playground/client entry.',
  },
  {
    dir: 'packages/agent-playground/src',
    importSpecifier: '@robota-sdk/agent-remote-client',
    type: 'agent-playground-missing-remote-client-import',
    detail:
      'agent-playground should keep reusable remote execution behavior in the package, backed by agent-remote-client.',
  },
];

const SERVER_FORBIDDEN_OWNERSHIP_PATTERNS = [
  {
    pattern:
      /\b(?:class|interface|type|const)\s+\w*(?:ProviderSemantics|ProviderModelCatalog|SessionPolicy|PlaygroundUiState|PlaygroundViewState)\b/,
    type: 'agent-server-forbidden-ownership',
    detail:
      'agent-server routing must not become the owner of provider semantics, session policy, or Playground UI state.',
  },
];

const REQUIRED_DOCUMENTATION = [
  {
    file: 'apps/agent-server/docs/SPEC.md',
    pattern: /Provider secrets and direct vendor API calls stay server-side in this app\./,
    type: 'missing-agent-server-secret-boundary',
    detail: 'agent-server SPEC must state provider secret and direct vendor-call ownership.',
  },
  {
    file: 'apps/agent-server/docs/SPEC.md',
    pattern: /does not\s+own provider semantics, session policy, or Playground UI state/,
    type: 'missing-agent-server-non-ownership-boundary',
    detail:
      'agent-server SPEC must state that provider semantics, session policy, and Playground UI state are not server-owned.',
  },
  {
    file: 'apps/agent-web/docs/SPEC.md',
    pattern:
      /must not import provider packages, `apps\/agent-server`, or the root\s+`@robota-sdk\/agent-playground` entry/,
    type: 'missing-agent-web-browser-boundary',
    detail: 'agent-web SPEC must state the browser-safe Playground import boundary.',
  },
  {
    file: '.agents/specs/architecture-map/apps-and-deployment.md',
    pattern:
      /Remote execution contract ownership stays in `agent-remote-client` and reusable Playground\s+execution behavior stays in `agent-playground`/,
    type: 'missing-app-deployment-remote-owner-map',
    detail:
      'Architecture map must keep remote execution and reusable Playground behavior out of app hosts.',
  },
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
    relativePath.includes('/.next/') ||
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

async function readIfExists(root, relativePath) {
  try {
    return await fs.readFile(path.join(root, relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

async function readJsonIfExists(root, relativePath) {
  const content = await readIfExists(root, relativePath);
  if (content === undefined) {
    return undefined;
  }
  return JSON.parse(content);
}

function listAllDependencies(packageJson) {
  return Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  });
}

function extractImports(content) {
  const imports = new Set();
  const importPattern =
    /(?:from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  let match;
  while ((match = importPattern.exec(content)) !== null) {
    imports.add(match[1] ?? match[2] ?? match[3]);
  }
  return [...imports];
}

async function findPackageFindings(root) {
  const findings = [];

  for (const check of PACKAGE_CHECKS) {
    const packageJson = await readJsonIfExists(root, check.file);
    if (!packageJson) {
      findings.push({
        file: check.file,
        type: 'missing-package-manifest',
        detail: `${check.file} is required for app/server boundary checks.`,
      });
      continue;
    }
    for (const dependencyName of listAllDependencies(packageJson)) {
      if (!check.forbiddenPrefixes.some((prefix) => dependencyName.startsWith(prefix))) {
        continue;
      }
      findings.push({
        file: check.file,
        type: check.type,
        detail: `${check.detail} Found ${dependencyName}.`,
      });
    }
  }

  for (const check of REQUIRED_PACKAGE_DEPENDENCIES) {
    const packageJson = await readJsonIfExists(root, check.file);
    if (!packageJson) {
      continue;
    }
    const dependencies = listAllDependencies(packageJson);
    if (dependencies.some((dependencyName) => check.dependencyPattern.test(dependencyName))) {
      continue;
    }
    findings.push({
      file: check.file,
      type: check.type,
      detail: check.detail,
    });
  }

  return findings;
}

async function findSourceImportFindings(root) {
  const findings = [];

  for (const check of SOURCE_IMPORT_CHECKS) {
    for (const file of await walkFiles(root, check.dir)) {
      const content = await fs.readFile(path.join(root, file), 'utf8');
      for (const importSpecifier of extractImports(content)) {
        if (!check.forbiddenImport(importSpecifier)) {
          continue;
        }
        findings.push({
          file,
          type: check.type,
          detail: `${check.detail} Found import ${importSpecifier}.`,
        });
      }
    }
  }

  return findings;
}

async function findRequiredSourceImportFindings(root) {
  const findings = [];

  for (const check of REQUIRED_SOURCE_IMPORTS) {
    let found = false;
    for (const file of await walkFiles(root, check.dir)) {
      const content = await fs.readFile(path.join(root, file), 'utf8');
      if (extractImports(content).includes(check.importSpecifier)) {
        found = true;
        break;
      }
    }
    if (!found) {
      findings.push({
        file: check.dir,
        type: check.type,
        detail: check.detail,
      });
    }
  }

  return findings;
}

async function findServerOwnershipFindings(root) {
  const findings = [];

  for (const file of await walkFiles(root, 'apps/agent-server/src')) {
    const content = await fs.readFile(path.join(root, file), 'utf8');
    for (const check of SERVER_FORBIDDEN_OWNERSHIP_PATTERNS) {
      if (!check.pattern.test(content)) {
        continue;
      }
      findings.push({
        file,
        type: check.type,
        detail: check.detail,
      });
    }
  }

  return findings;
}

async function findDocumentationFindings(root) {
  const findings = [];

  for (const check of REQUIRED_DOCUMENTATION) {
    const content = await readIfExists(root, check.file);
    if (content !== undefined && check.pattern.test(content)) {
      continue;
    }
    findings.push({
      file: check.file,
      type: check.type,
      detail: check.detail,
    });
  }

  return findings;
}

export async function findAgentServerBoundaryFindings(root = WORKSPACE_ROOT) {
  return [
    ...(await findPackageFindings(root)),
    ...(await findSourceImportFindings(root)),
    ...(await findRequiredSourceImportFindings(root)),
    ...(await findServerOwnershipFindings(root)),
    ...(await findDocumentationFindings(root)),
  ];
}

export async function main() {
  const findings = await findAgentServerBoundaryFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('agent server boundary scan passed.\n');
    return;
  }

  process.stdout.write('agent server boundary scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
