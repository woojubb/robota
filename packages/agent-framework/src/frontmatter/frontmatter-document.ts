import { LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';

import type {
  IDecodeContext,
  IFrontmatterDecodeFailure,
  IFrontmatterDiagnostic,
  IFrontmatterSlice,
  TYamlNode,
} from './frontmatter-types.js';
import type { ParsedNode, YAMLError } from 'yaml';

interface ISourceLine {
  text: string;
  start: number;
  end: number;
  next: number;
}

interface ISourcePosition {
  line: number;
  column: number;
}

interface IForbiddenNode {
  node: ParsedNode;
  field?: string;
}

export interface IParsedFrontmatterDocument {
  context: IDecodeContext;
  contents: ParsedNode | null;
}

function readLine(content: string, start: number): ISourceLine {
  const newline = content.indexOf('\n', start);
  const rawEnd = newline === -1 ? content.length : newline;
  const end = rawEnd > start && content[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
  return {
    text: content.slice(start, end),
    start,
    end,
    next: newline === -1 ? content.length : newline + 1,
  };
}

export function splitFrontmatter(
  source: string,
  content: string,
): IFrontmatterSlice | IFrontmatterDecodeFailure | undefined {
  const opening = readLine(content, 0);
  if (opening.text !== '---') return undefined;

  let cursor = opening.next;
  while (cursor < content.length) {
    const line = readLine(content, cursor);
    if (line.text === '---') {
      return {
        header: content.slice(opening.next, line.start),
        body: content.slice(line.next),
      };
    }
    if (line.next === cursor) break;
    cursor = line.next;
  }

  return failure([
    {
      code: 'unterminated',
      source,
      line: 1,
      column: 1,
      expected: 'a closing delimiter line (---)',
      received: 'end of file',
    },
  ]);
}

export function failure(diagnostics: readonly IFrontmatterDiagnostic[]): IFrontmatterDecodeFailure {
  const [first, ...rest] = diagnostics;
  if (first === undefined) throw new Error('frontmatter failure requires at least one diagnostic');
  return { ok: false, diagnostics: [first, ...rest] };
}

function sourcePosition(context: IDecodeContext, rawOffset: number): ISourcePosition {
  const offset =
    context.header.length === 0 ? 0 : Math.max(0, Math.min(rawOffset, context.header.length - 1));
  const { line, col } = context.lineCounter.linePos(offset);
  return { line: line + 1, column: col };
}

function nodePosition(context: IDecodeContext, node: TYamlNode): ISourcePosition | undefined {
  const offset = node?.range?.[0];
  return offset === undefined ? undefined : sourcePosition(context, offset);
}

function receivedSummary(node: TYamlNode): string {
  if (isAlias(node)) return 'alias';
  if (isMap(node)) return 'mapping';
  if (isSeq(node)) return 'sequence';
  if (isScalar(node)) {
    if (node.value === null) return 'null';
    if (typeof node.value === 'string') return JSON.stringify(node.value);
    if (typeof node.value === 'number' && Number.isNaN(node.value)) return 'NaN';
    return String(node.value);
  }
  return 'missing value';
}

export function diagnosticAtNode(
  context: IDecodeContext,
  node: TYamlNode,
  diagnostic: Omit<IFrontmatterDiagnostic, 'source' | 'line' | 'column' | 'received'> & {
    received?: string;
  },
): IFrontmatterDiagnostic {
  const position = nodePosition(context, node);
  return {
    ...diagnostic,
    source: context.source,
    ...(position === undefined ? {} : position),
    received: diagnostic.received ?? receivedSummary(node),
  };
}

export function scalarString(node: TYamlNode): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined;
}

function topLevelFieldAtOffset(contents: ParsedNode | null, offset: number): string | undefined {
  if (!isMap(contents)) return undefined;
  for (const pair of contents.items) {
    const key = scalarString(pair.key);
    const start = isScalar(pair.key) ? pair.key.range?.[0] : undefined;
    const end = isScalar(pair.key) ? pair.key.range?.[1] : undefined;
    if (key === undefined) continue;
    if (start !== undefined && end !== undefined && offset >= start && offset <= end) return key;
    const valueStart = pair.value?.range?.[0];
    const valueEnd = pair.value?.range?.[2];
    if (
      valueStart !== undefined &&
      valueEnd !== undefined &&
      offset >= valueStart &&
      offset <= valueEnd
    ) {
      return key;
    }
  }
  return undefined;
}

function parserDiagnostic(
  context: IDecodeContext,
  error: YAMLError,
  contents: ParsedNode | null,
): IFrontmatterDiagnostic {
  const position = sourcePosition(context, error.pos[0]);
  const duplicate = error.code === 'DUPLICATE_KEY';
  return {
    code: duplicate ? 'duplicate-key' : 'yaml-syntax',
    source: context.source,
    ...position,
    ...(duplicate ? { field: topLevelFieldAtOffset(contents, error.pos[0]) } : {}),
    expected: duplicate ? 'unique mapping keys' : 'valid YAML frontmatter',
    received: `${error.code}: ${error.message}`,
  };
}

function findForbiddenNode(node: TYamlNode, field?: string): IForbiddenNode | undefined {
  if (isAlias(node)) return { node, field };
  if (isSeq(node)) {
    for (const item of node.items) {
      const found = findForbiddenNode(item, field);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isMap(node)) return undefined;

  for (const pair of node.items) {
    const key = scalarString(pair.key);
    const nestedField = field ?? key;
    if (key === '<<') return { node: pair.key, field };
    const keyForbidden = findForbiddenNode(pair.key, nestedField);
    if (keyForbidden !== undefined) return keyForbidden;
    const valueForbidden = findForbiddenNode(pair.value, nestedField);
    if (valueForbidden !== undefined) return valueForbidden;
  }
  return undefined;
}

export function parseFrontmatterDocument(
  source: string,
  header: string,
): IParsedFrontmatterDocument | IFrontmatterDecodeFailure {
  const lineCounter = new LineCounter();
  const document = parseDocument(header, {
    lineCounter,
    merge: false,
    prettyErrors: false,
    schema: 'core',
    strict: true,
    stringKeys: false,
    uniqueKeys: true,
  });
  const context: IDecodeContext = { source, lineCounter, header };
  const parserErrors = [...document.errors, ...document.warnings];
  if (parserErrors.length > 0) {
    return failure(
      parserErrors.map((error) => parserDiagnostic(context, error, document.contents)),
    );
  }

  const forbidden = findForbiddenNode(document.contents);
  if (forbidden !== undefined) {
    return failure([
      diagnosticAtNode(context, forbidden.node, {
        code: 'alias-or-merge-forbidden',
        ...(forbidden.field === undefined ? {} : { field: forbidden.field }),
        expected: 'frontmatter without aliases or merge keys',
      }),
    ]);
  }

  return { context, contents: document.contents };
}
