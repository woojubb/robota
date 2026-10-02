import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  createNodeHostContributionSource,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
} from '@robota-sdk/agent-framework';

import type { IContributionSource, TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import type { IOutputStyleFile, IOutputStyleSource } from '@robota-sdk/agent-preset';


const USER_OUTPUT_STYLE_PRECEDENCE = 10;
const PROJECT_OUTPUT_STYLE_PRECEDENCE = 20;
const MANAGED_OUTPUT_STYLE_PRECEDENCE = 1000;

/** Project output-style directories are searched at every ancestor from the root to cwd. */
export function projectOutputStyleDirectories(cwdRelative: string, runtime: ICliRuntimeContext): readonly string[] {
  const segments = cwdRelative.length === 0 ? [] : cwdRelative.split(sep);
  return Array.from({ length: segments.length + 1 }, (_, depth) =>
    join(...segments.slice(0, depth), join(runtime.layout.projectDirectory, 'output-styles')),
  );
}

interface IStyleFileSource {
  readonly listDirectory: IContributionSource['listDirectory'];
  readonly readText: IContributionSource['readText'];
}

function readStyleFiles(source: IStyleFileSource, directory: string): readonly IOutputStyleFile[] {
  return source
    .listDirectory(directory, 'discover output styles')
    .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.md'))
    .map((entry) => ({
      fileName: entry.name,
      content: source.readText(join(directory, entry.name), 'load output style') ?? '',
    }));
}

function userOutputStyleSource(runtime: ICliRuntimeContext): IOutputStyleSource {
  const source = createNodeHostContributionSource(runtime.layout.userRoot);
  return {
    scope: 'user',
    displayName: `${runtime.layout.userRoot}/output-styles`,
    precedence: USER_OUTPUT_STYLE_PRECEDENCE,
    files: readStyleFiles(source, 'output-styles'),
  };
}

function projectOutputStyleSources(
  cwd: string,
  projectAccess: TWorkspaceProjectAccess,
  runtime: ICliRuntimeContext,
): readonly IOutputStyleSource[] {
  if (projectAccess.status !== 'trusted') return [];
  const identity = getWorkspaceProjectIdentity(projectAccess.authority);
  const reader = getWorkspaceProjectReader(projectAccess.authority);
  const resolvedCwd = realpathSync(cwd);
  const cwdRelative = relative(identity.worktreeRoot, resolvedCwd);
  const sources: IOutputStyleSource[] = [];

  for (const [depth, directory] of projectOutputStyleDirectories(cwdRelative, runtime).entries()) {
    const files = readStyleFiles(reader, directory);
    if (files.length === 0) continue;
    sources.push({
      scope: 'project',
      displayName: `${identity.worktreeRoot}/${directory}`,
      // A deeper directory is closer to cwd and therefore wins over its ancestor.
      precedence: PROJECT_OUTPUT_STYLE_PRECEDENCE + depth,
      files,
    });
  }
  return sources;
}

/** Build trusted output-style source inputs. The registry/parser owns decoding and precedence. */
export function buildOutputStyleSources(options: {
  readonly productRuntime: ICliRuntimeContext;
  readonly cwd: string;
  readonly userHome: string;
  readonly projectAccess: TWorkspaceProjectAccess;
  readonly managedOutputStyleSources?: readonly IOutputStyleSource[];
  /** `--safe-mode`: only the built-in and managed styles. */
  readonly safeMode?: boolean;
}): readonly IOutputStyleSource[] {
  const managed = (options.managedOutputStyleSources ?? []).map((source, index) => ({
    ...source,
    scope: 'managed' as const,
    precedence: MANAGED_OUTPUT_STYLE_PRECEDENCE + index,
  }));
  if (options.safeMode === true) return managed;
  return [
    userOutputStyleSource(options.productRuntime),
    ...projectOutputStyleSources(options.cwd, options.projectAccess, options.productRuntime),
    ...managed,
  ];
}
