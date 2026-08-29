import { isMap, isScalar, isSeq } from 'yaml';

import { diagnosticAtNode, scalarString } from './frontmatter-document.js';

import type {
  IDecodeContext,
  TFrontmatterScalar,
  TValueResult,
  TYamlNode,
} from './frontmatter-types.js';
import type { TModelEffort } from '@robota-sdk/agent-core';

function invalidType(
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
  expected: string,
): TValueResult<never> {
  return {
    ok: false,
    diagnostic: diagnosticAtNode(context, node, { code: 'invalid-type', field, expected }),
  };
}

function invalidValue(
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
  expected: string,
): TValueResult<never> {
  return {
    ok: false,
    diagnostic: diagnosticAtNode(context, node, { code: 'invalid-value', field, expected }),
  };
}

export function decodeNonEmptyString(
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
): TValueResult<string> {
  if (!isScalar(node) || typeof node.value !== 'string') {
    return invalidType(context, node, field, 'a non-empty string');
  }
  if (node.value.length === 0) {
    return invalidValue(context, node, field, 'a non-empty string');
  }
  return { ok: true, value: node.value };
}

export function decodeBoolean(
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
): TValueResult<boolean> {
  if (!isScalar(node) || typeof node.value !== 'boolean') {
    return invalidType(context, node, field, 'a YAML boolean');
  }
  return { ok: true, value: node.value };
}

export function decodeStringList(
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
): TValueResult<string[]> {
  if (isSeq(node)) {
    if (node.items.length === 0) {
      return invalidValue(context, node, field, 'a non-empty string list');
    }
    const values: string[] = [];
    for (const item of node.items) {
      if (!isScalar(item) || typeof item.value !== 'string') {
        return invalidType(context, item, field, 'a list containing only non-empty strings');
      }
      if (item.value.length === 0) {
        return invalidValue(context, item, field, 'a list containing only non-empty strings');
      }
      values.push(item.value);
    }
    return { ok: true, value: values };
  }

  if (!isScalar(node) || typeof node.value !== 'string') {
    return invalidType(context, node, field, 'a string list or delimited string');
  }

  const values = node.value.includes(',')
    ? node.value.split(',').map((value) => value.trim())
    : node.value.trim().split(/\s+/);
  if (values.length === 0 || values.some((value) => value.length === 0)) {
    return invalidValue(
      context,
      node,
      field,
      'a non-empty comma- or whitespace-delimited string list',
    );
  }
  return { ok: true, value: values };
}

function isModelEffort(value: string): value is TModelEffort {
  return (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  );
}

export function decodeEffort(
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
): TValueResult<TModelEffort> {
  if (!isScalar(node) || typeof node.value !== 'string') {
    return invalidType(context, node, field, 'one of low, medium, high, xhigh, max');
  }
  if (!isModelEffort(node.value)) {
    return invalidValue(context, node, field, 'one of low, medium, high, xhigh, max');
  }
  return { ok: true, value: node.value };
}

export function decodeContext(
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
): TValueResult<'fork'> {
  if (!isScalar(node) || typeof node.value !== 'string') {
    return invalidType(context, node, field, 'fork');
  }
  if (node.value !== 'fork') return invalidValue(context, node, field, 'fork');
  return { ok: true, value: 'fork' };
}

export function decodePositiveSafeInteger(
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
): TValueResult<number> {
  if (!isScalar(node) || typeof node.value !== 'number') {
    return invalidType(context, node, field, 'a positive safe integer');
  }
  if (!Number.isSafeInteger(node.value) || node.value <= 0) {
    return invalidValue(context, node, field, 'a positive safe integer');
  }
  return { ok: true, value: node.value };
}

export function decodeMetadataMap(
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
): TValueResult<Record<string, TFrontmatterScalar>> {
  if (!isMap(node)) return invalidType(context, node, field, 'a scalar metadata mapping');

  const result: Record<string, TFrontmatterScalar> = {};
  for (const pair of node.items) {
    const key = scalarString(pair.key);
    if (key === undefined || key.length === 0) {
      return invalidType(context, pair.key, field, 'metadata with non-empty string keys');
    }
    if (!isScalar(pair.value)) {
      return invalidType(context, pair.value ?? pair.key, field, 'metadata with scalar values');
    }
    const value = pair.value.value;
    if (
      (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      return invalidType(
        context,
        pair.value,
        field,
        'metadata with string, finite-number, or boolean values',
      );
    }
    result[key] = value;
  }
  return { ok: true, value: result };
}
