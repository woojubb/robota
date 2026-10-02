import { join } from 'node:path';
import { assertContainedPath } from './plugin-paths.js';
import type {
  IFileSystem,
  IUniversalObjectValue,
  TUniversalValue,
} from '@robota-sdk/agent-core';

/** Static compatibility codes, never configuration values or credentials. */
export class McpContributionError extends Error {
  override readonly name = 'McpContributionError';
  constructor(readonly code: 'invalid-object' | 'unsupported-path') {
    super(code);
  }
}

function serverMap(value: TUniversalValue, fileDocument = true): IUniversalObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Date)
    throw new McpContributionError('invalid-object');
  const servers = fileDocument && Object.hasOwn(value, 'mcpServers') ? value.mcpServers : value;
  if (
    typeof servers !== 'object' ||
    servers === null ||
    Array.isArray(servers) ||
    servers instanceof Date
  )
    throw new McpContributionError('invalid-object');
  return servers;
}

/** Read declarations without activation. Later sources replace earlier names, never merge credentials. */
export function loadDeclaredMcpConfig(
  pluginDir: string,
  declaration: TUniversalValue | undefined,
  fs: IFileSystem,
  onSource?: (name: string, sourcePath: string) => void,
): TUniversalValue | undefined {
  const defaultPath = join(pluginDir, '.mcp.json');
  const read = (path: string): TUniversalValue => {
    assertContainedPath(pluginDir, path, 'read MCP contribution', fs);
    return JSON.parse(fs.readFileSync(path, 'utf-8')) as TUniversalValue;
  };
  const defaults = fs.existsSync(defaultPath) ? read(defaultPath) : undefined;
  if (declaration === undefined) return defaults;
  if (defaults !== undefined && onSource) {
    for (const name of Object.keys(serverMap(defaults))) onSource(name, defaultPath);
  }
  const sources = Array.isArray(declaration) ? declaration : [declaration];
  let servers: IUniversalObjectValue = defaults === undefined ? {} : { ...serverMap(defaults) };
  for (const source of sources) {
    let value = source;
    let sourcePath = join(pluginDir, '.claude-plugin', 'plugin.json');
    if (typeof source === 'string') {
      if (!source.startsWith('./') || !source.endsWith('.json') || source.includes('\\'))
        throw new McpContributionError('unsupported-path');
      sourcePath = join(pluginDir, source);
      value = read(sourcePath);
    }
    const additions = serverMap(value, typeof source === 'string');
    for (const name of Object.keys(additions)) onSource?.(name, sourcePath);
    servers = { ...servers, ...additions };
  }
  return { mcpServers: servers };
}
