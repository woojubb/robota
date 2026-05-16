import type { IProviderCapabilities } from '@robota-sdk/agent-core';
import type { IQwenProviderOptions } from './types';

const QWEN_RESPONSES_SOURCE = 'qwen-responses';
const ENABLE_WEB_SEARCH_REASON = 'Enable builtInWebTools.webSearch or builtInWebTools.webFetch.';
const ENABLE_WEB_FETCH_REASON = 'Enable builtInWebTools.webFetch.';

export function getQwenProviderCapabilities(options: IQwenProviderOptions): IProviderCapabilities {
  const webTools = options.builtInWebTools;
  const webSearchEnabled = webTools?.webSearch === true || webTools?.webFetch === true;
  const webFetchEnabled = webTools?.webFetch === true;

  return {
    functionCalling: { supported: true },
    nativeWebTools: {
      webSearch: webSearchEnabled
        ? { supported: true, enabled: true, source: QWEN_RESPONSES_SOURCE }
        : {
            supported: true,
            enabled: false,
            source: QWEN_RESPONSES_SOURCE,
            reason: ENABLE_WEB_SEARCH_REASON,
          },
      webFetch: webFetchEnabled
        ? { supported: true, enabled: true, source: QWEN_RESPONSES_SOURCE }
        : {
            supported: true,
            enabled: false,
            source: QWEN_RESPONSES_SOURCE,
            reason: ENABLE_WEB_FETCH_REASON,
          },
    },
  };
}
