import { basename, extname } from 'node:path';

import { builtInOutputStyles } from './output-styles.js';

import type {
  IOutputStyle,
  IOutputStyleFile,
  IOutputStyleLoadResult,
  IOutputStyleRegistry,
  IOutputStyleSource,
  IOutputStyleSummary,
  TOutputStyleSource,
  TOutputStyleTokenCost,
} from './output-style-types.js';

export { builtInOutputStyles } from './output-styles.js';

const TOKEN_COSTS = new Set<TOutputStyleTokenCost>([
  'baseline',
  'low',
  'medium',
  'high',
  'unspecified',
]);

function stripScalarQuotes(value: string): string {
  return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
}

function parseBoolean(field: string, raw: string): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${field}: expected boolean, received "${raw}"`);
}

function parseFrontmatter(
  fileName: string,
  content: string,
): { values: Record<string, string>; instructions: string } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new Error('frontmatter: expected an opening --- marker');
  }
  const values: Record<string, string> = {};
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '---') {
      end = index;
      break;
    }
    if (line.trim() === '') continue;
    const match = /^([a-z][a-z0-9-]*):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`frontmatter: invalid entry at line ${index + 1}`);
    const key = match[1]!;
    if (values[key] !== undefined) throw new Error(`frontmatter.${key}: duplicate field`);
    values[key] = stripScalarQuotes(match[2]!.trim());
  }
  if (end < 0) throw new Error('frontmatter: expected a closing --- marker');
  const unknown = Object.keys(values).filter(
    (key) => !['name', 'description', 'keep-coding-instructions', 'token-cost'].includes(key),
  );
  if (unknown.length > 0) {
    throw new Error(`frontmatter.${unknown[0]}: unknown field`);
  }
  return {
    values,
    instructions: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  };
}

function fileId(fileName: string): string {
  const id = basename(fileName, extname(fileName)).trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    throw new Error(`id: expected the Markdown filename stem to be a slug, received "${id}"`);
  }
  return id.toLowerCase();
}

export function parseOutputStyleFile(
  file: IOutputStyleFile,
  source: TOutputStyleSource,
): IOutputStyle {
  if (!file.fileName.endsWith('.md')) {
    throw new Error('file: expected a .md output-style file');
  }
  const id = fileId(file.fileName);
  const parsed = parseFrontmatter(file.fileName, file.content);
  const name = parsed.values.name?.trim() || basename(file.fileName, '.md');
  const description = parsed.values.description?.trim() || `Custom output style: ${name}`;
  const keepCodingInstructions =
    parsed.values['keep-coding-instructions'] === undefined
      ? false
      : parseBoolean(
          'frontmatter.keep-coding-instructions',
          parsed.values['keep-coding-instructions'],
        );
  const tokenCost = parsed.values['token-cost'] ?? 'unspecified';
  if (!TOKEN_COSTS.has(tokenCost as TOutputStyleTokenCost)) {
    throw new Error(
      `frontmatter.token-cost: expected baseline|low|medium|high|unspecified, received "${tokenCost}"`,
    );
  }
  if (parsed.instructions.length === 0) {
    throw new Error('body: expected non-empty style instructions');
  }
  return {
    id,
    name,
    description,
    instructions: parsed.instructions,
    keepCodingInstructions,
    tokenCost: tokenCost as TOutputStyleTokenCost,
    source,
  };
}

function summarize(style: IOutputStyle): IOutputStyleSummary {
  return {
    id: style.id,
    name: style.name,
    description: style.description,
    tokenCost: style.tokenCost,
    source: style.source,
  };
}

export function loadOutputStylesFromSources(
  sources: readonly IOutputStyleSource[],
): IOutputStyleLoadResult {
  const styles = new Map<string, IOutputStyle>();
  const errors: { file: string; error: string }[] = [];
  for (const style of builtInOutputStyles) styles.set(style.id, style);

  const orderedSources = [...sources].sort((a, b) => a.precedence - b.precedence);
  for (const source of orderedSources) {
    const seenInSource = new Set<string>();
    for (const file of [...source.files].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
      const displayFile = `${source.displayName}/${file.fileName}`;
      let style: IOutputStyle;
      try {
        style = parseOutputStyleFile(file, source.scope);
      } catch (error) {
        errors.push({
          file: displayFile,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (seenInSource.has(style.id)) {
        errors.push({ file: displayFile, error: `duplicate style id "${style.id}" in source` });
        continue;
      }
      seenInSource.add(style.id);
      if (styles.get(style.id)?.source === 'built-in') {
        errors.push({
          file: displayFile,
          error: `style id "${style.id}" collides with a built-in`,
        });
        continue;
      }
      styles.set(style.id, style);
    }
  }
  return {
    styles: [...styles.values()],
    loaded: [...styles.values()]
      .filter((style) => style.source !== 'built-in')
      .map((style) => style.id),
    errors,
  };
}

export function createOutputStyleRegistry(
  sources: readonly IOutputStyleSource[] = [],
): IOutputStyleRegistry {
  const loaded = loadOutputStylesFromSources(sources);
  const byId = new Map(loaded.styles.map((style) => [style.id, style]));
  return {
    listOutputStyles: () => loaded.styles.map(summarize),
    getOutputStyle: (id: string) => byId.get(id),
  };
}
