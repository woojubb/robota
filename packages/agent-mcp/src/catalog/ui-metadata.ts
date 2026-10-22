/**
 * The only MCP Apps tool metadata this runtime interprets: `_meta.ui`. The deprecated flat
 * `_meta['ui/resourceUri']` is deliberately not read, and the raw `_meta` object never reaches the
 * catalog or diagnostics (the same boundary as `./result-size-metadata.ts`).
 */

export type TMCPToolUiAudience = 'model' | 'app';

export type TMCPToolUiProblem = 'invalid-type' | 'invalid-uri' | 'invalid-visibility';

/**
 * What a tool declared about its view. `resourceUri` is absent for a tool that only narrows who may
 * call it; a tool that declares neither a view nor a narrowing is
 * `absent`, not accepted.
 */
export interface IMCPToolUiReference {
  readonly resourceUri?: string;
  readonly visibility: readonly TMCPToolUiAudience[];
}

export type TMCPToolUiMetadata =
  | { readonly kind: 'absent' }
  | ({ readonly kind: 'accepted' } & IMCPToolUiReference)
  | { readonly kind: 'invalid'; readonly reason: TMCPToolUiProblem };

const UI_URI_PREFIX = 'ui://';
const WHITESPACE = /\s/u;
const DEFAULT_VISIBILITY: readonly TMCPToolUiAudience[] = ['model', 'app'];

function isAudience(value: unknown): value is TMCPToolUiAudience {
  return value === 'model' || value === 'app';
}

/** A non-empty array of unique audiences, or `undefined` when the declaration is malformed. */
function parseVisibility(value: unknown): readonly TMCPToolUiAudience[] | undefined {
  if (value === undefined) return DEFAULT_VISIBILITY;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const audiences: TMCPToolUiAudience[] = [];
  for (const item of value as readonly unknown[]) {
    if (!isAudience(item) || audiences.includes(item)) return undefined;
    audiences.push(item);
  }
  return audiences;
}

function isViewUri(value: string): boolean {
  return (
    value.startsWith(UI_URI_PREFIX) && value.length > UI_URI_PREFIX.length && !WHITESPACE.test(value)
  );
}

/** Projects one strictly typed view reference and visibility without retaining source metadata. */
export function parseMCPToolUiMetadata(rawMeta: unknown): TMCPToolUiMetadata {
  if (rawMeta === null || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) {
    return { kind: 'absent' };
  }
  const meta = rawMeta as Record<string, unknown>;
  if (!Object.hasOwn(meta, 'ui')) return { kind: 'absent' };
  const ui = meta['ui'];
  if (ui === null || typeof ui !== 'object' || Array.isArray(ui)) {
    return { kind: 'invalid', reason: 'invalid-type' };
  }
  const declared = ui as Record<string, unknown>;
  const resourceUri = declared['resourceUri'];
  if (resourceUri !== undefined) {
    if (typeof resourceUri !== 'string') return { kind: 'invalid', reason: 'invalid-type' };
    if (!isViewUri(resourceUri)) return { kind: 'invalid', reason: 'invalid-uri' };
  }
  const visibility = parseVisibility(declared['visibility']);
  if (visibility === undefined) return { kind: 'invalid', reason: 'invalid-visibility' };
  if (resourceUri === undefined) {
    return visibility.includes('model') && visibility.includes('app')
      ? { kind: 'absent' }
      : { kind: 'accepted', visibility };
  }
  return { kind: 'accepted', resourceUri, visibility };
}
