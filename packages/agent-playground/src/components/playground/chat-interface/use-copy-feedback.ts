import { useCallback, useState } from 'react';

import { WebLogger } from '../../../lib/web-logger';
import { COPY_FEEDBACK_DURATION_MS } from './constants';

interface IUseCopyFeedbackReturn {
  copiedId: string | null;
  copyToClipboard: (text: string, messageId: string) => Promise<void>;
}

export function useCopyFeedback(): IUseCopyFeedbackReturn {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = useCallback(async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), COPY_FEEDBACK_DURATION_MS);
    } catch (error) {
      WebLogger.error('Failed to copy', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  return { copiedId, copyToClipboard };
}
