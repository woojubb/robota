/**
 * Shared pipeline spec parser.
 * Parses pipeline strings like:
 *   "input | transform[prefix=→] | text-output"
 *   "input | llm-text-anthropic[model=claude-haiku,systemPrompt=Answer briefly] | text-output"
 */

export interface IPipelineNodeSpec {
  readonly nodeType: string;
  readonly config: Readonly<Record<string, string | number | boolean>>;
}

export type TPipelineParseResult =
  | { readonly ok: true; readonly nodes: readonly IPipelineNodeSpec[] }
  | { readonly ok: false; readonly message: string };

function inferConfigValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== '') return num;
  return raw;
}

/**
 * Parse inline config string like: `prefix=→ ,suffix= ←,count=3,enabled=true`
 * Values containing commas must be quoted: `systemPrompt="Hello, world"`
 */
function parseInlineConfig(
  configStr: string,
):
  | { readonly ok: true; readonly config: Record<string, string | number | boolean> }
  | { readonly ok: false; readonly message: string } {
  const config: Record<string, string | number | boolean> = {};
  let i = 0;
  // Do NOT trim — value trailing spaces are significant (e.g. prefix=→ )
  const s = configStr;

  while (i < s.length) {
    // Skip leading whitespace
    while (i < s.length && s[i] === ' ') i++;
    if (i >= s.length) break;

    // Read key (up to '=')
    const keyStart = i;
    while (i < s.length && s[i] !== '=') i++;
    if (i >= s.length) {
      return {
        ok: false,
        message: `Invalid config entry: missing '=' near "${s.slice(keyStart)}"`,
      };
    }
    const key = s.slice(keyStart, i).trim();
    if (!key) {
      return { ok: false, message: 'Config key must not be empty.' };
    }
    i++; // skip '='

    // Read value
    let value: string;
    if (s[i] === '"') {
      // Quoted value
      i++; // skip opening '"'
      const valueStart = i;
      while (i < s.length && s[i] !== '"') i++;
      if (i >= s.length) {
        return { ok: false, message: `Unclosed quote in config value for key "${key}"` };
      }
      value = s.slice(valueStart, i);
      i++; // skip closing '"'
      // Skip optional comma
      while (i < s.length && s[i] === ' ') i++;
      if (i < s.length && s[i] === ',') i++;
    } else {
      // Unquoted value: read until ',' or end
      const valueStart = i;
      while (i < s.length && s[i] !== ',') i++;
      value = s.slice(valueStart, i);
      if (i < s.length && s[i] === ',') i++; // skip comma
    }

    config[key] = inferConfigValue(value);
  }

  return { ok: true, config };
}

/**
 * Parse a single node spec segment like `transform[prefix=→ ,count=3]` or `input`.
 */
function parsePipelineNodeSpec(
  part: string,
):
  | { readonly ok: true; readonly node: IPipelineNodeSpec }
  | { readonly ok: false; readonly message: string } {
  const bracketIdx = part.indexOf('[');
  if (bracketIdx === -1) {
    return { ok: true, node: { nodeType: part.trim(), config: {} } };
  }

  const nodeType = part.slice(0, bracketIdx).trim();
  if (!nodeType) {
    return { ok: false, message: `Node spec has empty nodeType: "${part}"` };
  }

  const closeBracket = part.lastIndexOf(']');
  if (closeBracket === -1 || closeBracket < bracketIdx) {
    return { ok: false, message: `Unclosed '[' in node spec: "${part}"` };
  }

  const configStr = part.slice(bracketIdx + 1, closeBracket);
  if (!configStr.trim()) {
    return { ok: true, node: { nodeType, config: {} } };
  }

  const configResult = parseInlineConfig(configStr);
  if (!configResult.ok) {
    return { ok: false, message: configResult.message };
  }

  return { ok: true, node: { nodeType, config: configResult.config } };
}

/**
 * Parse a full pipeline spec string into node specs.
 * Returns an error if the spec is empty or any segment is malformed.
 */
export function parsePipelineSpec(spec: string): TPipelineParseResult {
  const parts = spec
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length === 0) {
    return { ok: false, message: '--pipeline value is empty.' };
  }

  const nodes: IPipelineNodeSpec[] = [];
  for (const part of parts) {
    const result = parsePipelineNodeSpec(part);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
    nodes.push(result.node);
  }

  return { ok: true, nodes };
}
