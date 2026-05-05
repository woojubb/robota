import { useCallback, useState } from 'react';

import { COPY_FEEDBACK_DURATION_MS } from './error-panel-config';

export function useErrorPanelState() {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const copyToClipboard = useCallback(async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), COPY_FEEDBACK_DURATION_MS);
  }, []);

  const toggleExpanded = useCallback((index: number) => {
    setExpandedItems((currentItems) => {
      const nextItems = new Set(currentItems);
      if (nextItems.has(index)) {
        nextItems.delete(index);
      } else {
        nextItems.add(index);
      }
      return nextItems;
    });
  }, []);

  return {
    copiedText,
    expandedItems,
    copyToClipboard,
    toggleExpanded,
  };
}
