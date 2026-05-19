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
import {
  Bot,
  Trash2,
  Wrench,
  Sparkles,
  Wifi,
  WifiOff,
  Loader2,
  FileText,
  X,
  History,
  Clock,
} from 'lucide-react';
import type { IPlaygroundAgentConfig } from '../../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../../tools/catalog';
import type { IPlaygroundSkillMeta } from '../../skills/catalog';
import { getPlaygroundSkillCatalog } from '../../skills/catalog';
import { ChatInterface } from '../../components/playground/chat-interface';
import type { IChatPanelMessage } from '../../components/playground/chat-interface/types';
import { fetchSessions } from '../../lib/playground/robota-executor/sse-client';
import type { ISessionSummary } from '../../lib/playground/robota-executor/sse-client';
import { Toaster } from '../../components/ui/sonner';
import { WebLogger } from '../../lib/web-logger';
import { useToast } from '../../hooks/use-toast';
import { CreateAgentModal, AddToolModal } from './playground-modals';
import { AssemblyCanvas } from '../../components/playground/assembly-canvas';
import { CodeExportPanel } from '../../components/playground/code-export/code-export-panel';
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
  const { setToolItems, setConversationHistory, clearHistory } = usePlaygroundActions();
  const { createAgent, popRestoredMessages, getDefaultAgentConfig, executePrompt, canExecute } =
    useRobotaExecution();
  const { injectToolIntoAgent } = usePlaygroundActions();
  const { isModalOpen, openModal, closeModal } = useModal();
  const [agentDraft, setAgentDraft] = useState<IPlaygroundAgentConfig | null>(null);
  const [chatTab, setChatTab] = useState<'chat' | 'code'>('chat');
  const [rightTab, setRightTab] = useState<'tools' | 'skills'>('tools');
  const { toast } = useToast();
  const toolItems = state.toolItems;
  const skillCatalog = useMemo(() => getPlaygroundSkillCatalog(), []);
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);
  const [skillMdViewer, setSkillMdViewer] = useState<IPlaygroundSkillMeta | null>(null);
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

  // Session management state
  const [chatKey, setChatKey] = useState(0);
  const [initialMessages, setInitialMessages] = useState<IChatPanelMessage[]>([]);
  const [sessions, setSessions] = useState<ISessionSummary[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const sessionsRef = useRef<HTMLDivElement | null>(null);

  // Close sessions dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sessionsRef.current && !sessionsRef.current.contains(e.target as Node)) {
        setSessionsOpen(false);
      }
    };
    if (sessionsOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sessionsOpen]);

  const loadSessions = async () => {
    if (isByokMode) return;
    const list = await fetchSessions(state.serverUrl, undefined);
    setSessions(list);
  };

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

  const handleAgentSubmit = async (resumeSessionId?: string) => {
    const resolvedResumeSessionId =
      typeof resumeSessionId === 'string' ? resumeSessionId : undefined;
    if (agentDraft) {
      const skills = activeSkills;
      await createAgent({
        ...agentDraft,
        skills,
        ...(resolvedResumeSessionId ? { resumeSessionId: resolvedResumeSessionId } : {}),
      });
      const restored = popRestoredMessages()
        .filter(
          (m): m is typeof m & { role: 'user' | 'assistant' } =>
            m.role === 'user' || m.role === 'assistant',
        )
        .map((m, i) => ({
          id: `restored-${i}`,
          role: m.role,
          content: m.content,
          timestamp: new Date(),
          status: 'sent' as const,
        }));
      setInitialMessages(restored);
      setChatKey((k) => k + 1);
      setAgentDraft(null);
      closeModal();
    }
  };

  const handleClearChat = () => {
    if (isByokMode) {
      byokHistoryRef.current = [];
    } else {
      clearHistory();
    }
    setInitialMessages([]);
    setChatKey((k) => k + 1);
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

  const currentAgentId = state.currentAgentConfig
    ? state.currentAgentConfig.id || state.currentAgentConfig.name
    : null;

  const agentActiveToolIds = currentAgentId ? (state.addedToolsByAgent[currentAgentId] ?? []) : [];
  const activeTools = useMemo(
    () => toolItems.filter((t) => agentActiveToolIds.includes(t.id)),
    [toolItems, agentActiveToolIds],
  );
  const activeSkills = useMemo(
    () => skillCatalog.filter((s) => activeSkillIds.includes(s.id)),
    [skillCatalog, activeSkillIds],
  );

  const handleDropTool = async (tool: IPlaygroundToolMeta) => {
    if (!currentAgentId) {
      toast({ title: 'Create an agent first', variant: 'destructive' });
      return;
    }
    if (agentActiveToolIds.includes(tool.id)) {
      toast({ title: `${tool.name} already added`, variant: 'default' });
      return;
    }
    if (tool.type !== 'builtin') {
      toast({ title: 'Custom tools cannot be injected yet', variant: 'destructive' });
      return;
    }
    await injectToolIntoAgent(currentAgentId, {
      id: tool.id,
      name: tool.name,
      description: tool.description,
    });
    toast({ title: `${tool.name} added to agent` });
  };

  const recreateAgentWithSkills = async (newSkillIds: string[]) => {
    const config = state.currentAgentConfig;
    if (!config) return;
    const newSkills = skillCatalog.filter((s) => newSkillIds.includes(s.id));
    await createAgent({ ...config, skills: newSkills });
    setInitialMessages([]);
    setChatKey((k) => k + 1);
  };

  const handleDropSkill = (skill: IPlaygroundSkillMeta) => {
    if (!currentAgentId) {
      toast({ title: 'Create an agent first', variant: 'destructive' });
      return;
    }
    if (activeSkillIds.includes(skill.id)) {
      toast({ title: `${skill.name} already added`, variant: 'default' });
      return;
    }
    const newIds = [...activeSkillIds, skill.id];
    setActiveSkillIds(newIds);
    void recreateAgentWithSkills(newIds);
    toast({ title: `${skill.name} added to agent` });
  };

  const handleRemoveSkill = (skill: IPlaygroundSkillMeta) => {
    const newIds = activeSkillIds.filter((id) => id !== skill.id);
    setActiveSkillIds(newIds);
    void recreateAgentWithSkills(newIds);
    toast({ title: 'Skill removed', description: `${skill.name} was removed.` });
  };

  const handleRestoreSession = async (sessionSummary: ISessionSummary) => {
    setSessionsOpen(false);
    const config = state.currentAgentConfig ?? getDefaultAgentConfig();
    await createAgent({ ...config, skills: activeSkills, resumeSessionId: sessionSummary.id });
    const restoredMsgs = popRestoredMessages();
    const restored = restoredMsgs
      .filter(
        (m): m is typeof m & { role: 'user' | 'assistant' } =>
          m.role === 'user' || m.role === 'assistant',
      )
      .map((m, i) => ({
        id: `chat-restored-${i}`,
        role: m.role,
        content: m.content,
        timestamp: new Date(),
        status: 'sent' as const,
      }));
    setInitialMessages(restored);
    setChatKey((k) => k + 1);
    setConversationHistory(
      restoredMsgs.map((m, i) => ({
        id: `restored-${i}`,
        type: (m.role === 'user'
          ? 'user_message'
          : m.role === 'assistant'
            ? 'assistant_response'
            : m.role === 'tool_call'
              ? 'tool_call_start'
              : 'tool_call_complete') as import('../../lib/playground/plugins/playground-history-plugin').TPlaygroundEventName,
        timestamp: new Date(),
        content: m.content,
        toolName: m.toolName,
      })),
    );
    toast({ title: 'Session restored', description: `${restored.length} messages loaded` });
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
          {!isByokMode && state.isInitialized && (
            <div ref={sessionsRef} className="relative">
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={async () => {
                  if (!sessionsOpen) await loadSessions();
                  setSessionsOpen((o) => !o);
                }}
              >
                <History className="h-3.5 w-3.5" />
                Sessions
              </Button>
              {sessionsOpen && (
                <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-md shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-border text-xs font-medium text-muted-foreground">
                    Saved sessions
                  </div>
                  {sessions.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                      No saved sessions yet
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      {sessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
                          onClick={() => void handleRestoreSession(s)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-foreground truncate">
                              {s.name ?? s.id.slice(0, 8)}
                            </span>
                            <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {s.messageCount}
                            </span>
                          </div>
                          {s.preview && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {s.preview}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground/60 mt-0.5">
                            {new Date(s.updatedAt).toLocaleString()}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
        {/* Left: Chat / Code Export tabs */}
        <div className="flex-1 h-full overflow-hidden border-r border-border flex flex-col">
          <div className="px-3 py-1.5 border-b border-border flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setChatTab('chat')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                chatTab === 'chat'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setChatTab('code')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                chatTab === 'code'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Code Export
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {chatTab === 'chat' ? (
              <ChatInterface
                key={chatKey}
                isAgentReady={isAgentReady}
                onSendMessage={handleSendMessage}
                onClearChat={handleClearChat}
                starterPrompts={isAgentReady ? BYOK_STARTER_PROMPTS : undefined}
                availableCommands={activeSkills.map((s) => ({
                  name: s.id,
                  description: s.description,
                }))}
                initialMessages={initialMessages}
              />
            ) : (
              <CodeExportPanel
                agentConfig={state.currentAgentConfig}
                activeTools={activeTools}
                activeSkills={activeSkills}
              />
            )}
          </div>
        </div>

        {/* Center: Agent Assembly Canvas */}
        <div className="flex-1 h-full overflow-hidden border-r border-border">
          <AssemblyCanvas
            agentConfig={state.currentAgentConfig}
            activeTools={activeTools}
            activeSkills={activeSkills}
            onDropTool={handleDropTool}
            onDropSkill={handleDropSkill}
            events={state.conversationHistory}
          />
        </div>

        {/* Right: Tools / Skills tabs */}
        <div className="w-64 h-full bg-card border-l border-border flex flex-col overflow-hidden">
          {/* Tab header */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setRightTab('tools')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                rightTab === 'tools'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Wrench className="h-3.5 w-3.5" />
              Tools
            </button>
            <button
              type="button"
              onClick={() => setRightTab('skills')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                rightTab === 'skills'
                  ? 'bg-violet-500/15 text-violet-400'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Skills
            </button>
          </div>

          {/* Tools panel */}
          {rightTab === 'tools' && (
            <div className="flex-1 flex flex-col overflow-hidden p-3">
              <div className="flex-1 space-y-2 overflow-auto pr-1">
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
                          tool.type === 'builtin'
                            ? 'Builtin tools cannot be removed'
                            : 'Remove tool'
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
          )}

          {/* Skills panel */}
          {rightTab === 'skills' && (
            <div className="flex-1 flex flex-col overflow-hidden p-3">
              <div className="flex-1 space-y-2 overflow-auto pr-1">
                {skillCatalog.map((skill) => (
                  <div
                    key={skill.id}
                    className="border border-violet-500/30 rounded bg-card hover:shadow-sm hover:border-violet-500/50 transition-all"
                  >
                    <div className="flex items-start gap-2 p-3">
                      <button
                        type="button"
                        className="flex-1 text-left cursor-grab select-none focus:outline-none focus:ring-2 focus:ring-violet-500 rounded"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/robota-skill', JSON.stringify(skill));
                        }}
                        title="Drag onto an agent node to add"
                      >
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="h-3 w-3 text-violet-400 shrink-0" />
                          <div className="text-sm font-medium text-foreground">{skill.name}</div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-3">
                          {skill.description}
                        </div>
                        {skill.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {skill.tags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-block bg-violet-500/10 text-violet-400 text-xs px-2 py-1 rounded"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                      <div className="flex flex-col gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setSkillMdViewer(skill)}
                          title="View SKILL.md"
                        >
                          <FileText className="h-3.5 w-3.5 text-violet-400" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={!activeSkillIds.includes(skill.id)}
                          onClick={() => handleRemoveSkill(skill)}
                          title={
                            activeSkillIds.includes(skill.id) ? 'Remove skill' : 'Not yet added'
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
      {skillMdViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-lg shadow-xl w-[640px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <span className="text-sm font-semibold text-foreground">
                  {skillMdViewer.name} — SKILL.md
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSkillMdViewer(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed">
                {skillMdViewer.skillMdContent}
              </pre>
            </div>
          </div>
        </div>
      )}
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
