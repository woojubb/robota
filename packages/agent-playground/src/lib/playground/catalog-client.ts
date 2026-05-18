export interface IModelEntry {
  id: string;
  name: string;
  contextWindow: number;
  supportsTools: boolean;
}

export interface IProviderEntry {
  id: string;
  name: string;
  serverKeyAvailable: boolean;
  byokSupported: boolean;
  models: IModelEntry[];
}

export interface IToolEntry {
  id: string;
  name: string;
  description: string;
  inputSchema: object;
  category: string;
}

function buildBaseUrl(serverUrl: string): string {
  return serverUrl
    .replace(/^wss/, 'https')
    .replace(/^ws/, 'http')
    .replace(/\/ws\/playground$/, '')
    .replace(/\/ws$/, '');
}

export async function fetchProviderCatalog(serverUrl: string): Promise<IProviderEntry[]> {
  const resp = await fetch(`${buildBaseUrl(serverUrl)}/api/playground/catalog/providers`);
  if (!resp.ok) throw new Error(`Failed to fetch provider catalog: ${resp.status}`);
  const data = (await resp.json()) as { providers: IProviderEntry[] };
  return data.providers;
}

export async function fetchToolCatalog(serverUrl: string): Promise<IToolEntry[]> {
  const resp = await fetch(`${buildBaseUrl(serverUrl)}/api/playground/catalog/tools`);
  if (!resp.ok) throw new Error(`Failed to fetch tool catalog: ${resp.status}`);
  const data = (await resp.json()) as { tools: IToolEntry[] };
  return data.tools;
}
