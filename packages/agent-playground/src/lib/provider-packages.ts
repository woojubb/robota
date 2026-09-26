/** Import paths of the per-vendor provider packages that playground code is written against. */
export const PROVIDER_PACKAGES = {
  openai: '@robota-sdk/agent-provider-openai',
  anthropic: '@robota-sdk/agent-provider-anthropic',
  gemini: '@robota-sdk/agent-provider-gemini',
  google: '@robota-sdk/agent-provider-gemini/google',
  openaiCompatible: '@robota-sdk/agent-provider-openai-compatible',
} as const;

/** The installable npm package name of an import path, without any subpath. */
export function toPackageName(importPath: string): string {
  const segments = importPath.split('/');
  return segments.slice(0, importPath.startsWith('@') ? 2 : 1).join('/');
}
