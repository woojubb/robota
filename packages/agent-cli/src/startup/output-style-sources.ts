import { realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  createNodeHostContributionSource,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
} from '@robota-sdk/agent-framework';

import type { IContributionSource, TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import type { IOutputStyleFile, IOutputStyleSource } from '@robota-sdk/agent-preset';

const OUTPUT_STYLE_DIRECTORY = join('.robota', 'output-styles');
const USER_OUTPUT_STYLE_PRECEDENCE = 10;
const PROJECT_OUTPUT_STYLE_PRECEDENCE = 20;
const MANAGED_OUTPUT_STYLE_PRECEDENCE = 1000;

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

function userOutputStyleSource(userHome: string): IOutputStyleSource {
  const source = createNodeHostContributionSource(userHome);
  return {
    scope: 'user',
    displayName: `${userHome}/${OUTPUT_STYLE_DIRECTORY}`,
    precedence: USER_OUTPUT_STYLE_PRECEDENCE,
    files: readStyleFiles(source, OUTPUT_STYLE_DIRECTORY),
  };
}

function projectOutputStyleSources(
  cwd: string,
  projectAccess: TWorkspaceProjectAccess,
): readonly IOutputStyleSource[] {
  if (projectAccess.status !== 'trusted') return [];
  const identity = getWorkspaceProjectIdentity(projectAccess.authority);
  const reader = getWorkspaceProjectReader(projectAccess.authority);
  const resolvedCwd = realpathSync(cwd);
  const cwdRelative = relative(identity.worktreeRoot, resolvedCwd);
  const segments = cwdRelative.length === 0 ? [] : cwdRelative.split(sep);
  const sources: IOutputStyleSource[] = [];

  for (let depth = 0; depth <= segments.length; depth += 1) {
    const directory = join(...segments.slice(0, depth), OUTPUT_STYLE_DIRECTORY);
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
  readonly cwd: string;
  readonly userHome: string;
  readonly projectAccess: TWorkspaceProjectAccess;
  readonly managedOutputStyleSources?: readonly IOutputStyleSource[];
}): readonly IOutputStyleSource[] {
  const managed = (options.managedOutputStyleSources ?? []).map((source, index) => ({
    ...source,
    scope: 'managed' as const,
    precedence: MANAGED_OUTPUT_STYLE_PRECEDENCE + index,
  }));
  return [
    userOutputStyleSource(options.userHome),
    ...projectOutputStyleSources(options.cwd, options.projectAccess),
    ...managed,
  ];
}
