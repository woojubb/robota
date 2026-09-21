/**
 * Environment templates in MCP definitions (MCP-001).
 *
 * `${VAR}` and `${VAR:-default}` are materialized in `command`, `args`, `env`, `url` and `headers`.
 *
 * An unset reference with no default is NOT an error and NOT an empty string. It is reported as a
 * warning and its literal `${VAR}` text is preserved. Both halves matter: substituting an empty
 * string would turn `https://host/${TOKEN}` into a working-looking URL that authenticates as
 * nobody, and failing outright would make one missing optional variable hide every other server in
 * the file.
 *
 * Pure: reads the environment map it is handed, never `process.env` directly, and contacts nothing.
 */

import type {
  IMCPServerDefinition,
  IMCPServerDefinitionResolved,
  IMCPUnsetVariable,
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

function materializeString(
  value: string,
  env: IMCPEnvironment,
  field: string,
  unset: IMCPUnsetVariable[],
): string {
  return value.replace(REFERENCE, (literal, variable: string, fallback?: string) => {
    const current = env[variable];
    if (current !== undefined) return current;
    if (fallback !== undefined) return fallback;
    unset.push({ variable, field, literal });
    return literal;
  });
}

function materializeRecord(
  record: Readonly<Record<string, string>>,
  env: IMCPEnvironment,
  prefix: string,
  unset: IMCPUnsetVariable[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = materializeString(value, env, `${prefix}.${key}`, unset);
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
  const unset: IMCPUnsetVariable[] = [];
  const resolved: {
    -readonly [K in keyof IMCPServerDefinitionResolved]: IMCPServerDefinitionResolved[K];
  } = { ...definition, unsetVariables: [] };

  if (definition.command !== undefined) {
    resolved.command = materializeString(definition.command, env, 'command', unset);
  }
  if (definition.args !== undefined) {
    resolved.args = definition.args.map((arg, index) =>
      materializeString(arg, env, `args[${index}]`, unset),
    );
  }
  if (definition.env !== undefined) {
    resolved.env = materializeRecord(definition.env, env, 'env', unset);
  }
  if (definition.url !== undefined) {
    resolved.url = materializeString(definition.url, env, 'url', unset);
  }
  if (definition.headers !== undefined) {
    resolved.headers = materializeRecord(definition.headers, env, 'headers', unset);
  }

  resolved.unsetVariables = unset;
  return resolved;
}
