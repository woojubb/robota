import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { atomicWriteUtf8File } from '../builtins/atomic-file-write';

const execFileAsync = promisify(execFile);

interface IValueModule {
  value: string;
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), `robota-atomic-write-${process.pid}-`));
}

async function importValueModule(moduleUrl: string): Promise<IValueModule> {
  return import(moduleUrl) as Promise<IValueModule>;
}

async function listRobotaTempFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory);
  return entries.filter((entry) => entry.includes('.robota-tmp-'));
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

describe('atomicWriteUtf8File', () => {
  it('Given an existing UTF-8 file When writing replacement content Then the target is replaced and temp files are cleaned', async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, 'target.txt');
    writeFileSync(filePath, 'before', 'utf8');

    await atomicWriteUtf8File(filePath, 'after');

    expect(readFileSync(filePath, 'utf8')).toBe('after');
    expect(await listRobotaTempFiles(dirname(filePath))).toEqual([]);
  });

  it('Given an executable target file When writing replacement content Then the target permissions are preserved', async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, 'script.sh');
    writeFileSync(filePath, '#!/bin/sh\necho before\n', 'utf8');
    chmodSync(filePath, 0o755);

    await atomicWriteUtf8File(filePath, '#!/bin/sh\necho after\n');

    expect(readFileSync(filePath, 'utf8')).toBe('#!/bin/sh\necho after\n');
    expect(statSync(filePath).mode & 0o777).toBe(0o755);
  });

  it('Given a target path that is a directory When replacement fails Then the directory remains and temp files are cleaned', async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const targetDir = join(dir, 'target-as-directory');
    mkdirSync(targetDir, { recursive: true });

    await expect(atomicWriteUtf8File(targetDir, 'content')).rejects.toThrow();

    expect(statSync(targetDir).isDirectory()).toBe(true);
    expect(await listRobotaTempFiles(dirname(targetDir))).toEqual([]);
  });

  it('Given a running process loaded old code When disk code is replaced Then a child process sees new code without replacing the current runtime', async () => {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, 'runtime-value.mjs');
    const moduleUrl = `${pathToFileURL(filePath).href}?handoff=${Date.now()}`;
    writeFileSync(filePath, 'export const value = "old";\n', 'utf8');
    const loadedBeforeWrite = await importValueModule(moduleUrl);

    await atomicWriteUtf8File(filePath, 'export const value = "new";\n');
    const loadedAfterWriteInCurrentProcess = await importValueModule(moduleUrl);
    const childScript = `const mod = await import(${JSON.stringify(moduleUrl)}); console.log(mod.value);`;
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '--eval',
      childScript,
    ]);

    expect(loadedBeforeWrite.value).toBe('old');
    expect(loadedAfterWriteInCurrentProcess.value).toBe('old');
    expect(stdout.trim()).toBe('new');
  });
});
