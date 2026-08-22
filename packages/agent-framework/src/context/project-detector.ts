/**
 * Project detector — infers project type, name, package manager, and language
 * from files present in the given directory.
 */
import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';

export type TProjectType = 'node' | 'python' | 'rust' | 'go' | 'unknown';
export type TPackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';
export type TLanguage = 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'unknown';

export interface IProjectInfo {
  type: TProjectType;
  name?: string;
  packageManager?: TPackageManager;
  language: TLanguage;
}

interface IPackageJson {
  name?: string;
  packageManager?: string;
}

function tryReadJson(
  reader: IWorkspaceProjectReader,
  relativePath: string,
): IPackageJson | undefined {
  const raw = reader.readText(relativePath, 'detect project package metadata');
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as IPackageJson;
  } catch {
    // allow-fallback: an absent/unreadable package.json means the project detail is simply unknown
    return undefined;
  }
}

function hasFile(reader: IWorkspaceProjectReader, relativePath: string): boolean {
  return reader.inspectKind(relativePath, 'detect project type') === 'file';
}

function detectPackageManager(reader: IWorkspaceProjectReader): TPackageManager | undefined {
  if (hasFile(reader, 'pnpm-workspace.yaml') || hasFile(reader, 'pnpm-lock.yaml')) {
    return 'pnpm';
  }
  if (hasFile(reader, 'yarn.lock')) {
    return 'yarn';
  }
  if (hasFile(reader, 'bun.lockb')) {
    return 'bun';
  }
  if (hasFile(reader, 'package-lock.json')) {
    return 'npm';
  }
  return undefined;
}

/**
 * Detect the project type, language, name, and package manager within an authenticated root.
 */
export async function detectProject(reader: IWorkspaceProjectReader): Promise<IProjectInfo> {
  const accepted = assertWorkspaceProjectReader(reader);

  // Node.js project
  if (hasFile(accepted, 'package.json')) {
    const pkgJson = tryReadJson(accepted, 'package.json');
    const language: TLanguage = hasFile(accepted, 'tsconfig.json') ? 'typescript' : 'javascript';
    const packageManager = detectPackageManager(accepted);
    return {
      type: 'node',
      name: pkgJson?.name,
      packageManager,
      language,
    };
  }

  // Python project
  if (hasFile(accepted, 'pyproject.toml') || hasFile(accepted, 'setup.py')) {
    return {
      type: 'python',
      language: 'python',
    };
  }

  // Rust project
  if (hasFile(accepted, 'Cargo.toml')) {
    return {
      type: 'rust',
      language: 'rust',
    };
  }

  // Go project
  if (hasFile(accepted, 'go.mod')) {
    return {
      type: 'go',
      language: 'go',
    };
  }

  return {
    type: 'unknown',
    language: 'unknown',
  };
}
