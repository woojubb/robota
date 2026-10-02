import { join } from 'node:path';
import type { ICliRuntimeContext } from './runtime-context.js';

export function createProductKeybindingsOptions(runtime: ICliRuntimeContext) {
  return { filePath: join(runtime.layout.userRoot, 'keybindings.json'), ...(runtime.config.identity.docsUrl !== undefined ? { schemaUrl: new URL('schemas/keybindings.schema.json', runtime.config.identity.docsUrl.endsWith('/') ? runtime.config.identity.docsUrl : `${runtime.config.identity.docsUrl}/`).href } : {}) };
}
