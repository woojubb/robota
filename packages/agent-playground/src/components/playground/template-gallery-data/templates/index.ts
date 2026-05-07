import { basicChatTemplate } from './basic-chat';
import { businessAnalystTemplate } from './business-analyst';
import { claudeCreativeTemplate } from './claude-creative';
import { knowledgeBaseTemplate } from './knowledge-base';
import { multiModalTemplate } from './multi-modal';
import { toolEnabledTemplate } from './tool-enabled';
import type { ITemplate } from '../types';

export const templates: ITemplate[] = [
  basicChatTemplate,
  toolEnabledTemplate,
  claudeCreativeTemplate,
  businessAnalystTemplate,
  multiModalTemplate,
  knowledgeBaseTemplate,
];
