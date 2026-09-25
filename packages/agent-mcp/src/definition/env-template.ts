/**
 * Environment templates in MCP definitions (MCP-001).
 *
 * `${VAR}` and `${VAR:-default}` are materialized in `command`, `args`, `cwd`, `env`, `url` and `headers`.
 *
 * An unset reference with no default is NOT an error and NOT an empty string. It is reported as a
 * warning and its literal `${VAR}` text is preserved. Both halves matter: substituting an empty
 * string would turn `https://host/${TOKEN}` into a working-looking URL that authenticates as
 * nobody, and failing outright would make one missing optional variable hide every other server in
 * the file.
 *
 * Pure: reads the environment map it is handed, never `process.env` directly, and contacts nothing.
 */

import { isCredentialShapedName } from './secrecy.js';

import type {
  IMCPServerDefinition,
  IMCPServerDefinitionResolved,
  IMCPUnsetVariable,
  IMCPValueSpan,
} from './types.js';

/**
 * `${NAME}` or `${NAME:-default}`.
 *
 * The default part is everything up to the closing brace, so `${A:-}` yields an empty default
 * (declared, unlike an unset variable) and `${A:-x:y}` keeps the colon in the default.
 */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export interface IMCPEnvironment {
  readonly [key: string]: string | undefined;
}

/** What materializing records beside the values: unset references and where each value came from. */
interface IMaterialization {
  readonly unset: IMCPUnsetVariable[];
  readonly provenance: Record<string, IMCPValueSpan[]>;
}

function materializeString(
  value: string,
  env: IMCPEnvironment,
  field: string,
  record: IMaterialization,
): string {
  const spans: IMCPValueSpan[] = [];
  let out = '';
  let consumed = 0;
  for (const match of value.matchAll(REFERENCE)) {
    const [literal, variable, fallback] = match as unknown as [string, string, string | undefined];
    const index = match.index ?? 0;
    out += value.slice(consumed, index);
    consumed = index + literal.length;
    const replacement = env[variable] ?? fallback;
    if (replacement === undefined) {
      record.unset.push({ variable, field, literal });
      out += literal;
      continue;
    }
    // A default stands in for the variable, so it is as secret as the variable's name says.
    spans.push({
      start: out.length,
      end: out.length + replacement.length,
      variable,
      secret: isCredentialShapedName(variable),
    });
    out += replacement;
  }
  out += value.slice(consumed);
  if (spans.length > 0) record.provenance[field] = spans;
  return out;
}

function materializeRecord(
  values: Readonly<Record<string, string>>,
  env: IMCPEnvironment,
  prefix: string,
  record: IMaterialization,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = materializeString(value, env, `${prefix}.${key}`, record);
  }
  return out;
}

/**
 * Materialize every templated field of one definition.
 *
 * The returned definition is always usable — the unset references travel beside it rather than
 * preventing it, so a caller can list a server and say what is missing from it in the same breath.
 */
export function materializeDefinition(
  definition: IMCPServerDefinition,
  env: IMCPEnvironment,
): IMCPServerDefinitionResolved {
  const record: IMaterialization = { unset: [], provenance: {} };
  const resolved: {
    -readonly [K in keyof IMCPServerDefinitionResolved]: IMCPServerDefinitionResolved[K];
  } = { ...definition, unsetVariables: [] };

  if (definition.command !== undefined) {
    resolved.command = materializeString(definition.command, env, 'command', record);
  }
  if (definition.args !== undefined) {
    resolved.args = definition.args.map((arg, index) =>
      materializeString(arg, env, `args[${index}]`, record),
    );
  }
  if (definition.cwd !== undefined) {
    resolved.cwd = materializeString(definition.cwd, env, 'cwd', record);
  }
  if (definition.env !== undefined) {
    resolved.env = materializeRecord(definition.env, env, 'env', record);
  }
  if (definition.url !== undefined) {
    resolved.url = materializeString(definition.url, env, 'url', record);
  }
  if (definition.headers !== undefined) {
    resolved.headers = materializeRecord(definition.headers, env, 'headers', record);
  }

  resolved.unsetVariables = record.unset;
  if (Object.keys(record.provenance).length > 0) resolved.provenance = record.provenance;
  return resolved;
}
