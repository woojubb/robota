/**
 * GrepTool — recursive regex content search.
 *
 * Supports two output modes:
 * - files_with_matches (default): return only file paths that contain a match
 * - content: return matching lines with optional context lines
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '../interfaces/tool.js';
import { asZodSchema } from './schema-cast.js';
import type { TToolResult } from '../cli-permissions/types.js';

/** Number of bytes to scan for null bytes in binary detection heuristic */
const BINARY_CHECK_BYTES = 8192;

const GrepSchema = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  path: z
    .string()
    .optional()
    .describe('File or directory to search in (default: current working directory)'),
  glob: z
    .string()
    .optional()
    .describe('Glob pattern to filter which files are searched (e.g. "*.ts")'),
  contextLines: z
    .number()
    .optional()
    .describe('Number of lines of context to include before and after each match (default: 0)'),
  outputMode: z
    .enum(['files_with_matches', 'content'])
    .optional()
    .describe('Output mode: "files_with_matches" (default) or "content"'),
});

type TGrepArgs = z.infer<typeof GrepSchema>;

/** Convert a simple glob to a RegExp for file name filtering. */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.+')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/** Check if a file name matches an optional glob filter. */
function matchesGlob(filename: string, glob: string | undefined): boolean {
  if (glob === undefined) return true;
  return globToRegex(glob).test(filename);
}

/** Gather all files under a directory recursively, excluding node_modules/.git. */
async function collectFiles(dirPath: string, glob: string | undefined): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entryNames: string[];
    try {
      entryNames = await readdir(current);
    } catch {
      return;
    }

    for (const name of entryNames) {
      if (name === 'node_modules' || name === '.git') continue;

      const fullPath = join(current, name);
      let fileStat: Awaited<ReturnType<typeof stat>>;
      try {
        fileStat = await stat(fullPath);
      } catch {
        continue;
      }

      if (fileStat.isDirectory()) {
        await walk(fullPath);
      } else if (fileStat.isFile()) {
        if (matchesGlob(name, glob)) {
          results.push(fullPath);
        }
      }
    }
  }

  await walk(dirPath);
  return results;
}

/** Search a single file for lines matching the regex. */
function searchFile(
  content: string,
  filePath: string,
  regex: RegExp,
  contextLines: number,
  outputMode: 'files_with_matches' | 'content',
): string[] {
  const lines = content.split('\n');
  const matchingIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      matchingIndices.push(i);
    }
  }

  if (matchingIndices.length === 0) return [];

  if (outputMode === 'files_with_matches') {
    return [filePath];
  }

  // content mode — include context lines
  const includedIndices = new Set<number>();
  for (const idx of matchingIndices) {
    for (
      let c = Math.max(0, idx - contextLines);
      c <= Math.min(lines.length - 1, idx + contextLines);
      c++
    ) {
      includedIndices.add(c);
    }
  }

  const outputLines: string[] = [];
  const sortedIndices = Array.from(includedIndices).sort((a, b) => a - b);

  let prevIdx: number | undefined;
  for (const idx of sortedIndices) {
    if (prevIdx !== undefined && idx > prevIdx + 1) {
      outputLines.push('--');
    }
    const lineNum = idx + 1;
    const marker = matchingIndices.includes(idx) ? ':' : '-';
    outputLines.push(`${filePath}:${lineNum}${marker}${lines[idx]}`);
    prevIdx = idx;
  }

  return outputLines;
}

/** Check if a buffer contains binary content by scanning for null bytes */
function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLen = Math.min(buffer.length, BINARY_CHECK_BYTES);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** Read file content as text, skipping binary files. Returns null if binary or unreadable. */
async function readTextContent(filePath: string): Promise<string | null> {
  try {
    const buffer = await readFile(filePath);
    if (isBinaryBuffer(buffer)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

/** Resolve target files from a path (single file or directory walk). Returns error string or file list. */
async function resolveTargetFiles(
  targetPath: string,
  glob: string | undefined,
): Promise<{ error: string } | { files: string[] }> {
  try {
    const targetStat = await stat(targetPath);
    if (targetStat.isFile()) return { files: [targetPath] };
    return { files: await collectFiles(targetPath, glob) };
  } catch {
    const result: TToolResult = {
      success: false,
      output: '',
      error: `Path not found: ${targetPath}`,
    };
    return { error: JSON.stringify(result) };
  }
}

async function grepFileTool(args: TGrepArgs): Promise<string> {
  const {
    pattern,
    path: searchPath,
    glob,
    contextLines = 0,
    outputMode = 'files_with_matches',
  } = args;
  const targetPath = searchPath ? resolve(searchPath) : process.cwd();

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    const result: TToolResult = {
      success: false,
      output: '',
      error: `Invalid regex pattern: ${pattern}`,
    };
    return JSON.stringify(result);
  }

  const resolved = await resolveTargetFiles(targetPath, glob);
  if ('error' in resolved) return resolved.error;

  const allOutputLines: string[] = [];
  for (const filePath of resolved.files) {
    const content = await readTextContent(filePath);
    if (content === null) continue;

    const fileMatches = searchFile(content, filePath, regex, contextLines, outputMode);
    allOutputLines.push(...fileMatches);
  }

  const result: TToolResult = {
    success: true,
    output: allOutputLines.length > 0 ? allOutputLines.join('\n') : '(no matches)',
  };
  return JSON.stringify(result);
}

/**
 * GrepTool instance — register with Robota agent tools registry.
 */
export const grepTool = createZodFunctionTool(
  'Grep',
  'Search file contents using a regular expression. Returns matching file paths or matching lines with context.',
  asZodSchema(GrepSchema),
  async (params: TToolParameters) => {
    return grepFileTool(params as TGrepArgs);
  },
);
