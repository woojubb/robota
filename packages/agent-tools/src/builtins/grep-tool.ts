/**
 * GrepTool — recursive regex content search.
 *
 * Supports three output modes:
 * - files_with_matches (default): return only file paths that contain a match
 * - content: return matching lines with optional context lines
 * - count: return per-file match counts as "path:count" rows
 *
 * headLimit caps the number of result lines; excess is truncated with a marker.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { createZodFunctionTool } from '../implementations/function-tool';

import type { IBuiltinToolDescriptionOptions } from './tool-options.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

const GrepSchema = z.object({
  pattern: z.string().describe('The regular expression pattern to search for in file contents'),
  path: z
    .string()
    .optional()
    .describe('File or directory to search in. Defaults to the current working directory'),
  glob: z
    .string()
    .optional()
    .describe(
      'Glob pattern to filter files (e.g. "*.ts", "*.{ts,tsx}"). Only files matching this pattern will be searched',
    ),
  contextLines: z
    .number()
    .optional()
    .describe(
      'Number of context lines to show before and after each match. Only applies when outputMode is "content". Default: 0',
    ),
  outputMode: z
    .enum(['files_with_matches', 'content', 'count'])
    .optional()
    .describe(
      'Output mode: "files_with_matches" shows only file paths (default), "content" shows matching lines with context, "count" shows per-file match counts',
    ),
  headLimit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Maximum number of result lines (file paths, content lines, or count rows) to return. Excess results are truncated with a marker line',
    ),
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
  outputMode: 'files_with_matches' | 'content' | 'count',
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

  if (outputMode === 'count') {
    return [`${filePath}:${matchingIndices.length}`];
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

async function grepFileTool(args: TGrepArgs): Promise<string> {
  const {
    pattern,
    path: searchPath,
    glob,
    contextLines = 0,
    outputMode = 'files_with_matches',
    headLimit,
  } = args;
  const targetPath = searchPath ? resolve(searchPath) : process.cwd();

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Invalid regex pattern: ${pattern}`,
    };
    return JSON.stringify(result);
  }

  // Determine whether targetPath is a file or directory
  let targetStat: Awaited<ReturnType<typeof stat>>;
  try {
    targetStat = await stat(targetPath);
  } catch {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Path not found: ${targetPath}`,
    };
    return JSON.stringify(result);
  }

  let files: string[];
  if (targetStat.isFile()) {
    files = [targetPath];
  } else {
    files = await collectFiles(targetPath, glob);
  }

  const allOutputLines: string[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      const buffer = await readFile(filePath);
      // Skip binary files
      const checkLen = Math.min(buffer.length, 8192);
      let hasBinary = false;
      for (let i = 0; i < checkLen; i++) {
        if (buffer[i] === 0) {
          hasBinary = true;
          break;
        }
      }
      if (hasBinary) continue;
      content = buffer.toString('utf8');
    } catch {
      continue;
    }

    const fileMatches = searchFile(content, filePath, regex, contextLines, outputMode);
    allOutputLines.push(...fileMatches);
  }

  let outputLines = allOutputLines;
  if (headLimit !== undefined && outputLines.length > headLimit) {
    const truncatedCount = outputLines.length - headLimit;
    outputLines = [
      ...outputLines.slice(0, headLimit),
      `(+${truncatedCount} more results truncated by headLimit)`,
    ];
  }

  const result: IToolInvocationResult = {
    success: true,
    output: outputLines.length > 0 ? outputLines.join('\n') : '(no matches)',
  };
  return JSON.stringify(result);
}

/** The registered name of the shell tool this package's default assembly ships (NEUT-002). */
const DEFAULT_SHELL_TOOL_NAME = 'Shell';

/** Options for the grep tool factory: description seam + derived shell-tool reference. */
export interface IGrepToolOptions extends IBuiltinToolDescriptionOptions {
  /**
   * Registered name of the shell tool the default description references (default: `Shell`).
   * Ignored when `description` overrides the text.
   */
  shellToolName?: string;
}

/** Build the default description, referencing the actually-registered shell tool by name. */
function buildGrepDescription(shellToolName: string): string {
  return `A powerful search tool built on regex matching.\n\nSupports full regex syntax (e.g., 'log.*Error', 'function\\\\s+\\\\w+'). Filter files with glob parameter (e.g., '*.js', '**/*.tsx').\n\nOutput modes: 'content' shows matching lines with context, 'files_with_matches' shows only file paths (default), 'count' shows per-file match counts.\n\nPrefer this tool over running grep or rg through the ${shellToolName} tool — it returns structured results directly.\n\nUse headLimit to control result size and save context space.`;
}

/**
 * Create a GrepTool instance — register with Robota agent tools registry.
 */
export function createGrepTool(options: IGrepToolOptions = {}): FunctionTool {
  return createZodFunctionTool(
    'Grep',
    options.description ?? buildGrepDescription(options.shellToolName ?? DEFAULT_SHELL_TOOL_NAME),
    GrepSchema,
    async (params) => {
      return grepFileTool(params);
    },
  );
}

/**
 * GrepTool instance — register with Robota agent tools registry.
 */
export const grepTool = createGrepTool();
