/**
 * Arguments for a call of a tool that its schema accepts by type, chosen so nothing the call does
 * leaves the workspace: what a test that drives every tool a session offers calls each one with.
 */

/** A value a tool's schema accepts by type. */
function probeValue(name: string, schema: { readonly type?: unknown } | undefined): unknown {
  switch (schema?.type) {
    case 'array':
      return [];
    case 'object':
      return {};
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return false;
    default:
      if (name === 'command') return 'true';
      if (/path/i.test(name)) return '{{cwd}}/probe.txt';
      return 'probe';
  }
}

/** Arguments for one call of `tool`: each required property, with a value of its type. */
export function probeArgs(tool: {
  readonly parameters?: {
    readonly required?: readonly string[];
    readonly properties?: Record<string, { readonly type?: unknown }>;
  };
}): Record<string, unknown> {
  return Object.fromEntries(
    (tool.parameters?.required ?? []).map((name) => [
      name,
      probeValue(name, tool.parameters?.properties?.[name]),
    ]),
  );
}
