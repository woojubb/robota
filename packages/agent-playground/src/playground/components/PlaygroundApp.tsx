'use client';

const CRYPTO_BYTES_COUNT = 3;
const HEX_BASE = 16;
const MAX_TOOL_SLUG_LENGTH = 40;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PlaygroundProvider,
  usePlaygroundState,
  usePlaygroundActions,
} from '../../contexts/playground-context';
import { useRobotaExecution } from '../../hooks/use-robota-execution';
import { useModal } from '../../hooks/use-modal';
import { Button } from '../../components/ui/button';
import { Bot, Trash2, Wrench, Wifi, WifiOff, Loader2 } from 'lucide-react';
import type { IPlaygroundAgentConfig } from '../../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../../tools/catalog';
import { ChatInterface } from '../../components/playground/chat-interface';
import { Toaster } from '../../components/ui/sonner';
import { WebLogger } from '../../lib/web-logger';
import { useToast } from '../../hooks/use-toast';
import { CreateAgentModal, AddToolModal } from './playground-modals';
import { WorkflowVisualization } from '../../components/playground/workflow-visualization';
import { useProviderConfig } from '../../hooks/use-provider-config';
import type { IProviderConfig } from '../../hooks/use-provider-config';
import { ProviderSetupScreen } from './ProviderSetupScreen';

export type TToolDraft = { name: string; description: string };

function slugifyKebab(input: string): string {
  const raw = input.trim().toLowerCase();
  const replaced = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return replaced.length > 0 ? replaced : 'tool';
}

function generateSixCharToken(): string {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('Crypto API is not available in this environment.');
  }
  const bytes = new Uint8Array(CRYPTO_BYTES_COUNT);
  cryptoObj.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(HEX_BASE).padStart(2, '0'))
    .join('');
}

function buildToolId(name: string): string {
  return `${slugifyKebab(name).slice(0, MAX_TOOL_SLUG_LENGTH)}-${generateSixCharToken()}`;
}

type TConnectionScreenProps = {
  status: 'connecting' | 'failed';
  error: string | null;
  serverUrl: string;
};

function ConnectionScreen({
  status,
  error,
  serverUrl,
}: TConnectionScreenProps): React.ReactElement {
  const isConnecting = status === 'connecting';
  return (
    <div className="w-full h-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 max-w-sm text-center px-6">
        {isConnecting ? (
          <div className="relative flex items-center justify-center w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10">
            <WifiOff className="w-8 h-8 text-destructive" />
          </div>
        )}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            {isConnecting ? 'Connecting to server' : 'Connection failed'}
          </h2>
          {isConnecting ? (
            <p className="text-sm text-muted-foreground font-mono break-all">{serverUrl}</p>
          ) : (
            <p className="text-sm text-muted-foreground mb-2">Could not reach the Robota server.</p>
          )}
          {error && (
            <p className="text-xs font-mono text-destructive bg-destructive/10 rounded px-3 py-2 break-all mt-2">
              {error}
            </p>
          )}
        </div>
        {!isConnecting && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
            className="gap-2"
          >
            <Wifi className="w-4 h-4" />
            Retry connection
          </Button>
        )}
      </div>
    </div>
  );
}

const BYOK_STARTER_PROMPTS = [
  'Explain what you can do',
  'Write a TypeScript function that reverses a string',
  'What are the key differences between TypeScript and JavaScript?',
];

type TByokMessage = { role: string; content: string };

async function sendByokMessage(
  message: string,
  config: IProviderConfig,
  baseUrl: string,
  historyRef: React.MutableRefObject<TByokMessage[]>,
): Promise<string> {
  historyRef.current.push({ role: 'user', content: message });
  const resp = await fetch(`${baseUrl}/api/v1/byok/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: config.provider,
      apiKey: config.apiKey,
      messages: historyRef.current,
    }),
  });
  if (!resp.ok) {
    const errJson = (await resp.json().catch(() => ({ error: 'Request failed' }))) as {
      error?: string;
    };
    throw new Error(errJson.error ?? 'Chat request failed');
  }
  const data = (await resp.json()) as {
    content?: string | Array<{ type: string; text?: string }>;
  };
  const text =
    typeof data.content === 'string'
      ? data.content
      : Array.isArray(data.content)
        ? data.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join('')
        : '';
  historyRef.current.push({ role: 'assistant', content: text });
  return text;
}

function buildByokBaseUrl(wsUrl: string): string {
  return wsUrl
    .replace(/^wss/, 'https')
    .replace(/^ws/, 'http')
    .replace(/\/ws\/playground$/, '')
    .replace(/\/ws$/, '');
}

function PlaygroundContent(): React.ReactElement {
  const state = usePlaygroundState();
  const { setToolItems } = usePlaygroundActions();
  const { createAgent, getDefaultAgentConfig, executePrompt, canExecute } = useRobotaExecution();
  const { isModalOpen, openModal, closeModal } = useModal();
  const [agentDraft, setAgentDraft] = useState<IPlaygroundAgentConfig | null>(null);
  const { toast } = useToast();
  const toolItems = state.toolItems;
  const toolItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [lastAddedToolId, setLastAddedToolId] = useState<string | null>(null);
  const sortedToolItems = useMemo(
    () => [...toolItems].sort((a, b) => a.name.localeCompare(b.name)),
    [toolItems],
  );
  const [toolDraft, setToolDraft] = useState<TToolDraft>({ name: '', description: '' });
  const { config: providerConfig, setConfig: setProviderConfig, clearConfig } = useProviderConfig();
  const byokHistoryRef = useRef<TByokMessage[]>([]);
  const isByokMode = !state.isInitialized && !!providerConfig;
  const byokBaseUrl = buildByokBaseUrl(state.serverUrl);

  useEffect(() => {
    if (!lastAddedToolId) return;
    const el = toolItemRefs.current.get(lastAddedToolId);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    el.focus();
    setLastAddedToolId(null);
  }, [lastAddedToolId, toolItems.length]);

  const handleSubmitAddTool = () => {
    const name = toolDraft.name.trim();
    if (!name) {
      toast({ title: 'Tool name is required', variant: 'destructive' });
      return;
    }
    const id = buildToolId(name);
    if (new Set(toolItems.map((t) => t.id)).has(id))
      WebLogger.warn('Tool ID collision detected', { id });
    setToolItems([...toolItems, { id, name, description: toolDraft.description.trim() }]);
    setLastAddedToolId(id);
    closeModal();
    toast({ title: 'Tool created', description: `${name} is now available in the sidebar.` });
  };

  const handleRemoveTool = (tool: IPlaygroundToolMeta) => {
    if (tool.type === 'builtin') {
      toast({ title: 'Builtin tools cannot be removed', variant: 'destructive' });
      return;
    }
    setToolItems(toolItems.filter((t) => t.id !== tool.id));
    toast({ title: 'Tool removed', description: `${tool.name} was removed.` });
  };

  const handleAgentSubmit = async () => {
    if (agentDraft) {
      await createAgent(agentDraft);
      setAgentDraft(null);
      closeModal();
    }
  };

  const handleSendMessage = async (message: string): Promise<string> => {
    if (isByokMode && providerConfig) {
      return sendByokMessage(message, providerConfig, byokBaseUrl, byokHistoryRef);
    }
    const result = await executePrompt(message);
    return result.response;
  };

  const handleDisconnectByok = () => {
    byokHistoryRef.current = [];
    clearConfig();
  };

  if (!state.isInitialized && !providerConfig) {
    if (state.error) {
      return <ProviderSetupScreen onConnect={setProviderConfig} />;
    }
    return <ConnectionScreen status="connecting" error={null} serverUrl={state.serverUrl} />;
  }

  const isAgentReady = isByokMode || canExecute;

  return (
    <div className="w-full h-full flex flex-col bg-background">
      <header className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Playground</h1>
          <p className="text-sm text-muted-foreground">
            {isByokMode
              ? `${providerConfig!.provider} · BYOK mode`
              : 'Interactive workflow visualization and controls'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isByokMode && (
            <Button
              onClick={() => {
                setAgentDraft(getDefaultAgentConfig());
                openModal('createAgent');
              }}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Bot className="h-4 w-4 mr-2" />
              Create Agent
            </Button>
          )}
          {isByokMode ? (
            <Button size="sm" variant="outline" onClick={handleDisconnectByok} className="gap-1">
              <WifiOff className="h-3 w-3" />
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              variant={state.isWebSocketConnected ? 'default' : 'secondary'}
              className="gap-1 pointer-events-none"
              tabIndex={-1}
            >
              <Wifi className="h-3 w-3" />
              {state.isWebSocketConnected ? 'Connected' : 'Disconnected'}
            </Button>
          )}
        </div>
      </header>
      <main className="flex-1 overflow-hidden flex">
        {/* Left: Chat */}
        <div className="flex-1 h-full overflow-hidden border-r border-border">
          <ChatInterface
            isAgentReady={isAgentReady}
            onSendMessage={handleSendMessage}
            starterPrompts={isAgentReady ? BYOK_STARTER_PROMPTS : undefined}
          />
        </div>

        {/* Center: Workflow Visualization */}
        <div className="flex-1 h-full overflow-hidden border-r border-border flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Workflow
            </span>
          </div>
          <div className="flex-1 overflow-hidden">
            <WorkflowVisualization events={state.conversationHistory} />
          </div>
        </div>

        {/* Right: Tools */}
        <div className="w-64 h-full bg-card border-l border-border overflow-y-auto">
          <div className="p-4 h-full flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Wrench className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold text-foreground">Tools</h3>
            </div>
            <div className="space-y-2 overflow-auto pr-1">
              {sortedToolItems.map((tool) => (
                <div
                  key={tool.id}
                  className="border border-border rounded bg-card hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-start gap-2 p-3">
                    <button
                      type="button"
                      className="flex-1 text-left cursor-grab select-none focus:outline-none focus:ring-2 focus:ring-primary rounded"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/robota-tool', JSON.stringify(tool));
                      }}
                      title="Drag onto an agent node to add"
                      ref={(el) => {
                        if (el) toolItemRefs.current.set(tool.id, el);
                      }}
                    >
                      <div className="text-sm font-medium text-foreground">{tool.name}</div>
                      <div className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-4">
                        {tool.description}
                      </div>
                      {tool.tags && tool.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {tool.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-block bg-primary/10 text-primary text-xs px-2 py-1 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={tool.type === 'builtin'}
                      onClick={() => handleRemoveTool(tool)}
                      title={
                        tool.type === 'builtin' ? 'Builtin tools cannot be removed' : 'Remove tool'
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  setToolDraft({ name: '', description: '' });
                  openModal('addTool');
                }}
              >
                + Add Tool
              </Button>
            </div>
          </div>
        </div>
      </main>
      <CreateAgentModal
        isOpen={isModalOpen('createAgent')}
        agentDraft={agentDraft}
        setAgentDraft={setAgentDraft}
        onSubmit={handleAgentSubmit}
        onClose={() => {
          setAgentDraft(null);
          closeModal();
        }}
      />
      <AddToolModal
        isOpen={isModalOpen('addTool')}
        toolDraft={toolDraft}
        setToolDraft={setToolDraft}
        onSubmit={handleSubmitAddTool}
        onClose={closeModal}
      />
    </div>
  );
}

export function PlaygroundApp(props: { defaultServerUrl?: string }): React.ReactElement {
  return (
    <>
      <Toaster />
      <PlaygroundProvider defaultServerUrl={props.defaultServerUrl ?? 'ws://localhost:3001'}>
        <PlaygroundContent />
      </PlaygroundProvider>
    </>
  );
}
