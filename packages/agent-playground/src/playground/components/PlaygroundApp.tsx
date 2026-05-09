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
import { Badge } from '../../components/ui/badge';
import { Bot, Trash2, Wrench } from 'lucide-react';
import type { IPlaygroundAgentConfig } from '../../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../../tools/catalog';
import { ChatInterface } from '../../components/playground/chat-interface';
import { Toaster } from '../../components/ui/sonner';
import { WebLogger } from '../../lib/web-logger';
import { useToast } from '../../hooks/use-toast';
import { CreateAgentModal, AddToolModal } from './playground-modals';
import { WorkflowVisualization } from '../../components/playground/workflow-visualization';

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
    const result = await executePrompt(message);
    return result.response;
  };

  return (
    <div className="w-full h-full min-h-[60vh] flex flex-col bg-background">
      <header className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Playground</h1>
          <p className="text-sm text-muted-foreground">
            Interactive workflow visualization and controls
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Badge variant={state.isInitialized ? 'default' : 'secondary'}>
            {state.isInitialized ? 'Ready' : 'Initializing'}
          </Badge>
        </div>
      </header>
      <main className="flex-1 overflow-hidden flex">
        {/* Left: Chat */}
        <div className="flex-1 h-full overflow-hidden border-r border-border">
          {state.isInitialized ? (
            <ChatInterface isAgentReady={canExecute} onSendMessage={handleSendMessage} />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Initializing playground...</div>
          )}
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
