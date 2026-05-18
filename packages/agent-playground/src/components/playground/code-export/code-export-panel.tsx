'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Code } from 'lucide-react';
import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../../../tools/catalog';
import { generateAgentCode } from '../../../lib/code-generator';
import { SyntaxHighlighter } from './syntax-highlighter';
import { InstallGuide } from './install-guide';

const DEBOUNCE_MS = 300;
const COPY_FEEDBACK_MS = 2000;

interface ICodeExportPanelProps {
  agentConfig: IPlaygroundAgentConfig | null;
  activeTools: IPlaygroundToolMeta[];
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function CodeExportPanel({ agentConfig, activeTools }: ICodeExportPanelProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const assemblyState = useMemo(
    () =>
      agentConfig
        ? {
            agent: {
              provider: agentConfig.defaultModel.provider,
              model: agentConfig.defaultModel.model,
              systemPrompt: agentConfig.defaultModel.systemMessage ?? '',
            },
            tools: activeTools.map((t) => t.id),
          }
        : null,
    [agentConfig, activeTools],
  );

  const debouncedState = useDebounced(assemblyState, DEBOUNCE_MS);

  const code = useMemo(
    () => (debouncedState ? generateAgentCode(debouncedState) : null),
    [debouncedState],
  );

  const handleCopy = useCallback(async () => {
    if (!code) return;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    try {
      await navigator.clipboard.writeText(code);
    } catch (_err) {
      // allow-fallback: clipboard API may be unavailable; fall back to DOM selection
      const sel = window.getSelection();
      const range = document.createRange();
      const pre = document.querySelector('[data-code-export-pre]');
      if (sel && pre) {
        range.selectNodeContents(pre);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    setCopied(true);
    copyTimerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }, [code]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  if (!agentConfig) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Code className="h-10 w-10 opacity-30" />
        <p className="text-sm">Create an agent to generate code</p>
        <p className="text-xs opacity-60">
          Configure an agent and tools to see the TypeScript code
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs font-medium text-muted-foreground">TypeScript</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-400" />
              <span className="text-green-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy Code</span>
            </>
          )}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 bg-zinc-950/50">
        <div data-code-export-pre>{code && <SyntaxHighlighter code={code} />}</div>
        <InstallGuide />
      </div>
    </div>
  );
}
