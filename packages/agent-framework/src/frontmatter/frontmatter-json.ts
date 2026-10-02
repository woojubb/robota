import { isMap, isScalar, isSeq } from 'yaml';
import {
  diagnosticAtNode,
  failure,
  parseFrontmatterDocument,
  splitFrontmatter,
} from './frontmatter-document.js';
import type { IUniversalObjectValue, TUniversalValue } from '@robota-sdk/agent-core';
import type { IDecodeContext, IFrontmatterDecodeFailure, TYamlNode } from './frontmatter-types.js';

export type TFrontmatterJsonResult =
  | {
      readonly ok: true;
      readonly frontmatter: IUniversalObjectValue;
      readonly body: string;
    }
  | IFrontmatterDecodeFailure;

function jsonValue(context: IDecodeContext, node: TYamlNode): TUniversalValue {
  if (node === null) return null;
  if (
    isScalar(node) &&
    (node.value === null ||
      typeof node.value === 'string' ||
      typeof node.value === 'boolean' ||
      (typeof node.value === 'number' && Number.isFinite(node.value)))
  )
    return node.value;
  if (isSeq(node)) return node.items.map((item) => jsonValue(context, item));
  if (isMap(node)) {
    const value = Object.create(null) as IUniversalObjectValue;
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string')
        throw failure([
          diagnosticAtNode(context, pair.key, {
            code: 'invalid-type',
            expected: 'a string JSON object key',
          }),
        ]);
      value[pair.key.value] = jsonValue(context, pair.value);
    }
    return value;
  }
  throw failure([
    diagnosticAtNode(context, node, { code: 'invalid-type', expected: 'a finite JSON value' }),
  ]);
}

/** Decode every YAML field for content equality; no profile normalization or instruction activation. */
export function decodeFrontmatterJson(
  source: string,
  content: string,
): TFrontmatterJsonResult | undefined {
  const sliced = splitFrontmatter(source, content);
  if (sliced === undefined || 'ok' in sliced) return sliced;
  const parsed = parseFrontmatterDocument(source, sliced.header);
  if ('ok' in parsed) return parsed;
  if (!isMap(parsed.contents))
    return failure([
      diagnosticAtNode(parsed.context, parsed.contents, {
        code: 'root-type',
        expected: 'a JSON object frontmatter mapping',
      }),
    ]);
  try {
    return {
      ok: true,
      frontmatter: jsonValue(parsed.context, parsed.contents) as IUniversalObjectValue,
      body: sliced.body,
    };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'ok' in error &&
      error.ok === false &&
      'diagnostics' in error
    )
      return error as IFrontmatterDecodeFailure;
    throw error;
  }
}
