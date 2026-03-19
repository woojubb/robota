/**
 * Project detector — infers project type, name, package manager, and language
 * from files present in the given directory.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

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

function tryReadJson(filePath: string): IPackageJson | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as IPackageJson;
  } catch {
    return undefined;
  }
}

function detectPackageManager(cwd: string): TPackageManager | undefined {
  if (existsSync(join(cwd, 'pnpm-workspace.yaml')) || existsSync(join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(cwd, 'yarn.lock'))) {
    return 'yarn';
  }
  if (existsSync(join(cwd, 'bun.lockb'))) {
    return 'bun';
  }
  if (existsSync(join(cwd, 'package-lock.json'))) {
    return 'npm';
  }
  return undefined;
}

/**
 * Detect the project type, language, name, and package manager from `cwd`.
 */
export async function detectProject(cwd: string): Promise<IProjectInfo> {
  const pkgJsonPath = join(cwd, 'package.json');
  const tsconfigPath = join(cwd, 'tsconfig.json');
  const pyprojectPath = join(cwd, 'pyproject.toml');
  const cargoPath = join(cwd, 'Cargo.toml');
  const goModPath = join(cwd, 'go.mod');

  // Node.js project
  if (existsSync(pkgJsonPath)) {
    const pkgJson = tryReadJson(pkgJsonPath);
    const language: TLanguage = existsSync(tsconfigPath) ? 'typescript' : 'javascript';
    const packageManager = detectPackageManager(cwd);
    return {
      type: 'node',
      name: pkgJson?.name,
      packageManager,
      language,
    };
  }

  // Python project
  if (existsSync(pyprojectPath) || existsSync(join(cwd, 'setup.py'))) {
    return {
      type: 'python',
      language: 'python',
    };
  }

  // Rust project
  if (existsSync(cargoPath)) {
    return {
      type: 'rust',
      language: 'rust',
    };
  }

  // Go project
  if (existsSync(goModPath)) {
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
