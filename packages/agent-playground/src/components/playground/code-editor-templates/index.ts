import { basicTemplate } from './basic';
import { multiProviderTemplate } from './multi-provider';
import { pluginsTemplate } from './plugins';
import { streamingTemplate } from './streaming';
import { toolsTemplate } from './tools';
import type { IExampleTemplates } from './types';

export type { IExampleTemplate, IExampleTemplates } from './types';

export const exampleTemplates: IExampleTemplates = {
  basic: basicTemplate,
  tools: toolsTemplate,
  streaming: streamingTemplate,
  multiProvider: multiProviderTemplate,
  plugins: pluginsTemplate,
};

export const defaultCode = exampleTemplates.basic.code;
