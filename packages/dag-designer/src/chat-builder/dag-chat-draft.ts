import { createCandidates, createCatalog, detectIntent } from './dag-chat-catalog.js';
import { buildImageDraft } from './dag-chat-image-draft.js';
import { createUnchangedResult } from './dag-chat-node-factory.js';
import { buildTextDraft } from './dag-chat-text-draft.js';
import { buildVideoDraft } from './dag-chat-video-draft.js';
import type { IDagChatDraftInput, IDagChatDraftResult } from './dag-chat-draft-types.js';

export type {
  IDagChatDraftInput,
  IDagChatDraftMessage,
  IDagChatDraftResult,
  IDagChatDraftWarning,
  TDagChatDraftStatus,
  TDagChatDraftWarningCode,
} from './dag-chat-draft-types.js';

export function buildDagChatDraft(input: IDagChatDraftInput): IDagChatDraftResult {
  const prompt = input.prompt.trim();
  if (prompt.length === 0) {
    return createUnchangedResult({
      status: 'empty-prompt',
      definition: input.definition,
      message: 'Enter a request before building a DAG draft.',
      warnings: [
        {
          code: 'DAG_CHAT_PROMPT_REQUIRED',
          message: 'The assistant needs a non-empty request.',
        },
      ],
    });
  }

  const catalog = createCatalog(input.objectInfo);
  if (catalog.length === 0) {
    return createUnchangedResult({
      status: 'needs-catalog',
      definition: input.definition,
      message: 'Refresh the node catalog before building a DAG draft.',
      warnings: [
        {
          code: 'DAG_CHAT_CATALOG_REQUIRED',
          message: 'No objectInfo entries are available.',
        },
      ],
    });
  }

  const intent = detectIntent(prompt);
  const candidates = createCandidates(catalog);
  const draft =
    (intent.wantsVideo
      ? buildVideoDraft({ definition: input.definition, prompt, intent, candidates })
      : undefined) ??
    (intent.wantsImage
      ? buildImageDraft({ definition: input.definition, prompt, intent, candidates })
      : undefined) ??
    buildTextDraft({ definition: input.definition, prompt, candidates });

  return draft ?? createNoPlanResult(input.definition);
}

function createNoPlanResult(definition: IDagChatDraftInput['definition']): IDagChatDraftResult {
  return createUnchangedResult({
    status: 'no-plan',
    definition,
    message: 'No compatible node chain was found in the current catalog.',
    warnings: [
      {
        code: 'DAG_CHAT_NO_COMPATIBLE_PLAN',
        message: 'The current objectInfo catalog does not expose nodes that match the request.',
      },
    ],
  });
}
