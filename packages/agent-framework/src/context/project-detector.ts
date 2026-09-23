/**
 * Project detector — infers project type, name, package manager, and language
 * from files present in the given directory.
 */
import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';

/** Fixed paths inspected by automatic project detection after workspace access is granted. */
export const PROJECT_DETECTOR_PATHS = {
  packageJson: 'package.json',
  tsconfig: 'tsconfig.json',
  pnpmWorkspace: 'pnpm-workspace.yaml',
  pnpmLock: 'pnpm-lock.yaml',
  yarnLock: 'yarn.lock',
  bunLock: 'bun.lockb',
  npmLock: 'package-lock.json',
  pyproject: 'pyproject.toml',
  setup: 'setup.py',
  cargo: 'Cargo.toml',
  goMod: 'go.mod',
} as const;

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
  if (
    hasFile(reader, PROJECT_DETECTOR_PATHS.pnpmWorkspace) ||
    hasFile(reader, PROJECT_DETECTOR_PATHS.pnpmLock)
  ) {
    return 'pnpm';
  }
  if (hasFile(reader, PROJECT_DETECTOR_PATHS.yarnLock)) {
    return 'yarn';
  }
  if (hasFile(reader, PROJECT_DETECTOR_PATHS.bunLock)) {
    return 'bun';
  }
  if (hasFile(reader, PROJECT_DETECTOR_PATHS.npmLock)) {
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
  if (hasFile(accepted, PROJECT_DETECTOR_PATHS.packageJson)) {
    const pkgJson = tryReadJson(accepted, PROJECT_DETECTOR_PATHS.packageJson);
    const language: TLanguage = hasFile(accepted, PROJECT_DETECTOR_PATHS.tsconfig)
      ? 'typescript'
      : 'javascript';
    const packageManager = detectPackageManager(accepted);
    return {
      type: 'node',
      name: pkgJson?.name,
      packageManager,
      language,
    };
  }

  // Python project
  if (
    hasFile(accepted, PROJECT_DETECTOR_PATHS.pyproject) ||
    hasFile(accepted, PROJECT_DETECTOR_PATHS.setup)
  ) {
    return {
      type: 'python',
      language: 'python',
    };
  }

  // Rust project
  if (hasFile(accepted, PROJECT_DETECTOR_PATHS.cargo)) {
    return {
      type: 'rust',
      language: 'rust',
    };
  }

  // Go project
  if (hasFile(accepted, PROJECT_DETECTOR_PATHS.goMod)) {
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
