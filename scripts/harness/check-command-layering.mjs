#!/usr/bin/env node

/**
 * Check command layering invariants that prevent built-in command behavior from
 * drifting into CLI/TUI hooks or SDK orchestration internals.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = process.cwd();

const TEXT_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md']);

const FORBIDDEN_PATHS = [
  {
    path: 'packages/agent-cli/src/commands/slash-executor.ts',
    type: 'cli-legacy-slash-executor',
    detail:
      'CLI must not keep a legacy built-in slash command switch; use session.executeCommand() and generic skill/plugin fallback.',
  },
  {
    path: 'packages/agent-cli/src/commands/plugin-source.ts',
    type: 'cli-legacy-plugin-source',
    detail:
      'CLI must not keep a local PluginCommandSource copy; use the SDK-owned PluginCommandSource.',
  },
];

const CLI_UI_FORBIDDEN_PATTERNS = [
  {
    type: 'cli-provider-command-state',
    pattern: /\b_pendingProvider(Profile|Setup)?\b/,
    detail:
      'CLI/TUI hooks must not own provider command state; use generic ICommandInteraction/effects.',
  },
  {
    type: 'cli-provider-command-flow',
    pattern:
      /\b(providerSetupInteraction|handleProviderCommand|routeProviderCommand|handleProviderConfirm)\b/,
    detail: 'Provider slash command flow belongs to a command module, not CLI/TUI code.',
  },
  {
    type: 'cli-provider-command-import',
    pattern:
      /from\s+['"][^'"]*(provider-command|provider-setup-interaction|provider-setup-flow|provider-settings)['"]/,
    detail:
      'CLI/TUI rendering code must not import provider setup/command helpers; render generic SDK prompts instead.',
  },
  {
    type: 'cli-command-effect-session-state',
    pattern: /(_pendingCommand(?:Interaction|Effects)|InteractiveSession\s*&\s*ISideEffects)/,
    detail:
      'CLI/TUI command effect transport must use an explicit CLI-owned queue, not ad hoc fields on InteractiveSession.',
  },
];

const CLI_FORBIDDEN_PATTERNS = [
  {
    type: 'cli-agent-sessions-import',
    pattern: /from\s+['"]@robota-sdk\/agent-sessions['"]/,
    detail:
      'agent-cli must not import @robota-sdk/agent-sessions; use SDK-owned session persistence APIs.',
  },
];

const CLI_SLASH_ROUTER_FORBIDDEN_PATTERNS = [
  {
    type: 'cli-command-specific-router-branch',
    pattern:
      /\bcmd\s*={2,3}\s*['"](agent|background|clear|compact|context|cost|exit|help|language|memory|mode|model|permissions|plugin|provider|reload-plugins|rename|reset|resume|rewind|statusline)['"]/,
    detail:
      'Slash routing must call session.executeCommand() and must not own built-in command-specific branches.',
  },
];

const SDK_FORBIDDEN_PATTERNS = [
  {
    type: 'sdk-command-package-import',
    pattern: /from\s+['"]@robota-sdk\/agent-command-[^'"]+['"]/,
    detail:
      'agent-sdk must not import command implementation packages; composition roots select command modules.',
  },
];

const COMMAND_PACKAGE_FORBIDDEN_PATTERNS = [
  {
    type: 'command-package-cli-import',
    pattern: /from\s+['"]@robota-sdk\/agent-cli['"]/,
    detail:
      'Command implementation packages must not depend on agent-cli or TUI rendering internals.',
  },
];

function isTextSourceFile(filePath) {
  return TEXT_SOURCE_EXTENSIONS.has(path.extname(filePath));
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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root, relativeDir) {
  const dir = path.join(root, relativeDir);
  if (!(await pathExists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
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
    if (entry.isFile() && isTextSourceFile(childRelativePath)) {
      files.push(childRelativePath);
    }
  }
  return files;
}

function findPatternFindings(file, content, checks) {
  const findings = [];
  for (const check of checks) {
    if (!check.pattern.test(content)) {
      continue;
    }
    findings.push({
      file,
      type: check.type,
      detail: check.detail,
    });
  }
  return findings;
}

async function readText(root, relativePath) {
  return await fs.readFile(path.join(root, relativePath), 'utf8');
}

function findSdkPackageDependencyFindings(packageJson) {
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  };

  return Object.keys(dependencies)
    .filter((name) => name.startsWith('@robota-sdk/agent-command-'))
    .map((name) => ({
      file: 'packages/agent-sdk/package.json',
      type: 'sdk-command-package-dependency',
      detail: `agent-sdk must not depend on command implementation package ${name}.`,
    }));
}

function findCliPackageDependencyFindings(packageJson) {
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  };

  return Object.keys(dependencies)
    .filter((name) => name === '@robota-sdk/agent-sessions')
    .map((name) => ({
      file: 'packages/agent-cli/package.json',
      type: 'cli-agent-sessions-dependency',
      detail: `agent-cli must not depend on ${name}; use @robota-sdk/agent-sdk facade APIs.`,
    }));
}

export async function findCommandLayeringFindings(root = WORKSPACE_ROOT) {
  const findings = [];

  for (const forbiddenPath of FORBIDDEN_PATHS) {
    if (await pathExists(path.join(root, forbiddenPath.path))) {
      findings.push({
        file: forbiddenPath.path,
        type: forbiddenPath.type,
        detail: forbiddenPath.detail,
      });
    }
  }

  for (const file of await walkFiles(root, 'packages/agent-cli/src/ui')) {
    findings.push(
      ...findPatternFindings(file, await readText(root, file), CLI_UI_FORBIDDEN_PATTERNS),
    );
  }

  for (const file of await walkFiles(root, 'packages/agent-cli/src')) {
    findings.push(...findPatternFindings(file, await readText(root, file), CLI_FORBIDDEN_PATTERNS));
  }

  const slashRouter = 'packages/agent-cli/src/ui/hooks/useSlashRouting.ts';
  if (await pathExists(path.join(root, slashRouter))) {
    findings.push(
      ...findPatternFindings(
        slashRouter,
        await readText(root, slashRouter),
        CLI_SLASH_ROUTER_FORBIDDEN_PATTERNS,
      ),
    );
  }

  for (const file of await walkFiles(root, 'packages/agent-sdk/src')) {
    findings.push(...findPatternFindings(file, await readText(root, file), SDK_FORBIDDEN_PATTERNS));
  }

  const sdkPackageJsonPath = path.join(root, 'packages/agent-sdk/package.json');
  if (await pathExists(sdkPackageJsonPath)) {
    findings.push(
      ...findSdkPackageDependencyFindings(
        JSON.parse(await fs.readFile(sdkPackageJsonPath, 'utf8')),
      ),
    );
  }

  const cliPackageJsonPath = path.join(root, 'packages/agent-cli/package.json');
  if (await pathExists(cliPackageJsonPath)) {
    findings.push(
      ...findCliPackageDependencyFindings(
        JSON.parse(await fs.readFile(cliPackageJsonPath, 'utf8')),
      ),
    );
  }

  const packagesDir = path.join(root, 'packages');
  if (await pathExists(packagesDir)) {
    const entries = await fs.readdir(packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('agent-command-')) {
        continue;
      }
      const relativeDir = path.join('packages', entry.name, 'src');
      for (const file of await walkFiles(root, relativeDir)) {
        findings.push(
          ...findPatternFindings(
            file,
            await readText(root, file),
            COMMAND_PACKAGE_FORBIDDEN_PATTERNS,
          ),
        );
      }
    }
  }

  return findings;
}

export async function main() {
  const findings = await findCommandLayeringFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('command layering scan passed.\n');
    return;
  }

  process.stdout.write('command layering scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
