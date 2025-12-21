'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { WorkflowView } from '../../workflow';
import { PlaygroundProvider, usePlayground } from '../../contexts/playground-context';
import { useRobotaExecution } from '../../hooks/use-robota-execution';
import { useModal } from '../../hooks/use-modal';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Modal } from '../../components/ui/modal';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Bot, Trash2, Wrench } from 'lucide-react';
import type { PlaygroundAgentConfig } from '../../lib/playground/robota-executor';
import type { PlaygroundToolMeta } from '../../tools/catalog';
import { ChatInputPanel } from '../../components/playground/chat-input-panel';
import { Toaster } from '../../components/ui/sonner';
import type { EventService, SimpleLogger } from '@robota-sdk/agents';
import type { WorkflowEventSubscriber } from '@robota-sdk/workflow';
import { WebLogger } from '../../lib/web-logger';
import { useToast } from '../../hooks/use-toast';
import { ToolRegistry } from '../../tools/catalog';

type ToolDraft = {
  name: string;
  description: string;
};

function slugifyKebab(input: string): string {
  const raw = input.trim().toLowerCase();
  const replaced = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  return replaced.length > 0 ? replaced : 'tool';
}

function generateSixCharToken(): string {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('Crypto API is not available in this environment.');
  }
  const bytes = new Uint8Array(3);
  cryptoObj.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildToolId(name: string): string {
  const base = slugifyKebab(name).slice(0, 40);
  const token = generateSixCharToken();
  return `${base}-${token}`;
}

function PlaygroundContent(): React.ReactElement {
  const { state, setWorkflow, addToolToAgentOverlay, setToolItems } = usePlayground();
  const { createAgent, getDefaultAgentConfig } = useRobotaExecution();
  const { activeModal, isModalOpen, openModal, closeModal } = useModal();
  const [agentDraft, setAgentDraft] = useState<PlaygroundAgentConfig | null>(null);
  const { toast } = useToast();
  const lastDropByAgentToolRef = useRef<Map<string, number>>(new Map());

  // Chat state
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const [chatNodeData, setChatNodeData] = useState<any>(null);

  // Catalog-driven tool list (context-owned)
  const toolItems = state.toolItems;
  const toolItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [lastAddedToolId, setLastAddedToolId] = useState<string | null>(null);

  const sortedToolItems = useMemo(() => {
    return [...toolItems].sort((a, b) => a.name.localeCompare(b.name));
  }, [toolItems]);

  // Add Tool modal draft state
  const [toolDraft, setToolDraft] = useState<ToolDraft>({ name: '', description: '' });

  useEffect(() => {
    if (!lastAddedToolId) return;
    const el = toolItemRefs.current.get(lastAddedToolId);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    el.focus();
    setLastAddedToolId(null);
  }, [lastAddedToolId, toolItems.length]);

  // System prompt templates
  const systemPromptTemplates = {
    'task_coordinator': `You are a Team Coordinator that manages collaborative work through intelligent task delegation.

CORE PRINCIPLES:
- Respond in the same language as the user's input
- For simple, single-component tasks, handle them directly yourself
- For complex or multi-faceted tasks, delegate to specialized team members
- Each delegated task must be self-contained and understandable without context
- Always synthesize and integrate results from team members into your final response

AVAILABLE ROLES:
- Specialists: Focus on specific domains and can handle targeted tasks efficiently

DELEGATION BEST PRACTICES:
- Create clear, standalone instructions for each specialist
- Avoid overlapping tasks between different team members
- Select appropriate specialist templates based on task requirements
- Ensure each delegated task is complete and actionable
- Handle final synthesis and coordination yourself

Your goal is to coordinate effectively while leveraging specialist expertise for optimal results.`,
    'general_assistant': `You are a helpful AI assistant. You provide accurate, helpful, and thoughtful responses to user queries. You can help with a wide variety of tasks including analysis, writing, problem-solving, and creative work.`,
    'creative_ideator': `You are a Creative Ideator specializing in innovative thinking and creative problem-solving. You excel at brainstorming, generating unique ideas, and approaching challenges from unconventional angles. Focus on creativity, originality, and out-of-the-box solutions.`,
    'analytical_specialist': `You are an Analytical Specialist focused on data analysis, logical reasoning, and systematic problem-solving. You excel at breaking down complex problems, analyzing information methodically, and providing evidence-based conclusions.`,
    'technical_expert': `You are a Technical Expert with deep knowledge in software development, system architecture, and technical problem-solving. You provide detailed technical guidance, code reviews, and architectural recommendations.`,
    'tool_expert_en': `You are a tool-calling expert who actively utilizes available tools to provide comprehensive solutions. Even after obtaining results from tool calls, you should continue making additional tool calls whenever they are necessary to complete the task thoroughly.

KEY PRINCIPLES:
- Always prioritize tool usage when tools can help solve the problem
- Make multiple tool calls in sequence when needed
- Don't stop at the first tool result if additional tools can provide more value
- Combine tool results intelligently to provide comprehensive answers
- Use tools proactively rather than reactively

Your expertise lies in knowing when, how, and how many times to call tools to achieve the best possible outcome.`,
    'tool_expert_ko': `당신은 도구 호출을 적극 활용하는 전문가입니다. 도구 호출로 결과를 얻었더라도 도구 호출이 추가로 필요할 때는 도구 호출을 추가로 해야 합니다.

핵심 원칙:
- 도구가 문제 해결에 도움이 될 때는 항상 도구 사용을 우선시하세요
- 필요할 때는 여러 도구를 연속적으로 호출하세요
- 추가 도구가 더 많은 가치를 제공할 수 있다면 첫 번째 도구 결과에서 멈추지 마세요
- 도구 결과들을 지능적으로 결합하여 포괄적인 답변을 제공하세요
- 반응적이 아닌 능동적으로 도구를 사용하세요

당신의 전문성은 최상의 결과를 달성하기 위해 언제, 어떻게, 몇 번 도구를 호출해야 하는지 아는 것입니다.`
  };

  const handleAgentNodeClick = (nodeId: string, data?: any) => {
    WebLogger.debug('Agent node clicked', { nodeId, data });
    // Open chat modal for the selected agent
    setChatAgentId(nodeId);
    setChatNodeData(data);
    openModal('chat');
  };

  const handleToolDrop = async (agentId: string, tool: PlaygroundToolMeta) => {
    WebLogger.debug('Tool dropped on agent', { agentId, toolId: tool.id, toolName: tool.name });
    try {
      // Debounce rapid duplicate drop events (same agentId + toolId).
      // This prevents multiple onDrop triggers from producing repeated toasts or repeated tool injection attempts.
      const dropKey = `${agentId}:${tool.id}`;
      const now = Date.now();
      const lastAt = lastDropByAgentToolRef.current.get(dropKey) ?? 0;
      if (now - lastAt < 300) {
        return;
      }
      lastDropByAgentToolRef.current.set(dropKey, now);

      const alreadyAdded = Array.isArray(state.addedToolsByAgent?.[agentId]) && state.addedToolsByAgent[agentId].includes(tool.id);
      if (alreadyAdded) {
        toast({
          title: 'Tool already added',
          description: `${tool.name} is already present on agent ${agentId}.`,
          variant: 'default',
        });
        return;
      }

      const isRegistered = Object.prototype.hasOwnProperty.call(ToolRegistry, tool.id);

      // UI-only tools are allowed (overlay only). Registered tools additionally update runtime via executor.
      if (!isRegistered) {
        addToolToAgentOverlay(agentId, tool.id);
        toast({
          title: 'Tool added (UI only)',
          description: `${tool.name} was added to the overlay for agent ${agentId}.`,
          variant: 'default',
        });
        return;
      }

      // Use PlaygroundExecutor to update agent tools (registered tools only)
      if (!state.executor) {
        throw new Error('Executor not initialized');
      }

      const result = await state.executor.updateAgentToolsFromCard(agentId, {
        id: tool.id,
        name: tool.name,
        description: tool.description
      });
      WebLogger.info('Tool successfully added to agent', { agentId, toolId: tool.id, result });
      addToolToAgentOverlay(agentId, tool.id);

      toast({
        title: 'Tool added',
        description: `${tool.name} was added to agent ${agentId}.`,
        variant: 'default',
      });
    } catch (error) {
      WebLogger.error('Failed to add tool to agent', { agentId, error: error instanceof Error ? error.message : String(error) });
      toast({
        title: 'Failed to add tool',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleOpenAddTool = () => {
    setToolDraft({ name: '', description: '' });
    openModal('addTool');
  };

  const handleSubmitAddTool = () => {
    const name = toolDraft.name.trim();
    const description = toolDraft.description.trim();
    if (!name) {
      toast({ title: 'Tool name is required', variant: 'destructive' });
      return;
    }

    const id = buildToolId(name);
    const existingIds = new Set(toolItems.map((t) => t.id));
    if (existingIds.has(id)) {
      toast({
        title: 'Tool ID collision',
        description: 'Please submit again to generate a new id.',
        variant: 'destructive',
      });
      return;
    }

    const next: PlaygroundToolMeta[] = [...toolItems, { id, name, description }];
    setToolItems(next);
    setLastAddedToolId(id);
    closeModal();
    toast({ title: 'Tool created', description: `${name} is now available in the sidebar.` });
  };

  const handleRemoveTool = (tool: PlaygroundToolMeta) => {
    if (tool.type === 'builtin') {
      toast({ title: 'Builtin tools cannot be removed', variant: 'destructive' });
      return;
    }
    const next = toolItems.filter((t) => t.id !== tool.id);
    setToolItems(next);
    toast({ title: 'Tool removed', description: `${tool.name} was removed.` });
  };

  const handleCreateAgent = () => {
    const config = getDefaultAgentConfig();
    setAgentDraft(config);
    openModal('createAgent');
  };

  const handleAgentSubmit = async () => {
    if (agentDraft) {
      await createAgent(agentDraft);
      setAgentDraft(null);
      closeModal();
    }
  };

  return (
    <div className="w-full h-full min-h-[60vh] flex flex-col">
      {/* Header with Create buttons */}
      <header className="px-4 py-2 border-b flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Playground</h1>
          <p className="text-sm text-muted-foreground">Interactive workflow visualization and controls</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleCreateAgent} size="sm" className="bg-blue-500 hover:bg-blue-600">
            <Bot className="h-4 w-4 mr-2" />
            Create Agent
          </Button>
          <Badge variant={state.isInitialized ? "default" : "secondary"}>
            {state.isInitialized ? "Ready" : "Initializing"}
          </Badge>
        </div>
      </header>

      {/* Main content with sidebar layout */}
      <main className="flex-1 overflow-hidden flex">
        {/* Center Column - Workflow Visualization */}
        <div className="flex-1 h-full">
          {state.isInitialized ? (
            <WorkflowView
              workflow={state.sdkWorkflow || undefined}
              onAgentNodeClick={handleAgentNodeClick}
              onToolDrop={handleToolDrop}
              toolItems={toolItems}
              addedToolsByAgent={state.addedToolsByAgent}
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Initializing playground...</div>
          )}
        </div>

        {/* Right Sidebar - Tools */}
        <div className="w-80 h-full bg-gray-50 border-l border-gray-200 shadow-lg overflow-y-auto">
          <div className="p-4 h-full flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Wrench className="h-5 w-5 text-gray-600" />
              <h3 className="font-semibold">Tools</h3>
            </div>
            <div className="space-y-2 overflow-auto pr-1">
              {sortedToolItems.map((tool) => (
                <div key={tool.id} className="border rounded bg-white hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-2 p-3">
                    <button
                      type="button"
                      className="flex-1 text-left cursor-grab select-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/robota-tool', JSON.stringify(tool));
                      }}
                      title="Drag onto an agent node to add"
                      ref={(el) => {
                        if (el) toolItemRefs.current.set(tool.id, el);
                      }}
                    >
                      <div className="text-sm font-medium">{tool.name}</div>
                      <div className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-4">{tool.description}</div>
                      {tool.tags && tool.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {tool.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded"
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
                      title={tool.type === 'builtin' ? 'Builtin tools cannot be removed' : 'Remove tool'}
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
                onClick={handleOpenAddTool}
              >
                + Add Tool
              </Button>
            </div>
          </div>
        </div>
      </main>

      {/* Create Agent Modal */}
      <Modal
        isOpen={isModalOpen('createAgent')}
        onClose={() => {
          setAgentDraft(null);
          closeModal();
        }}
        title="Create Agent"
        size="lg"
      >
        <div className="p-6 space-y-4">
          {agentDraft && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Agent Name</Label>
                  <Input
                    value={agentDraft.name}
                    onChange={(e) => setAgentDraft({ ...agentDraft, name: e.target.value })}
                    className="h-8 text-xs"
                    placeholder="Agent Name"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Provider</Label>
                  <Select
                    value={agentDraft.defaultModel.provider}
                    onValueChange={(value) => setAgentDraft({
                      ...agentDraft,
                      defaultModel: { ...agentDraft.defaultModel, provider: value }
                    })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">System Message</Label>
                  <Select
                    onValueChange={(value) => {
                      if (value && systemPromptTemplates[value as keyof typeof systemPromptTemplates]) {
                        setAgentDraft({
                          ...agentDraft,
                          defaultModel: {
                            ...agentDraft.defaultModel,
                            systemMessage: systemPromptTemplates[value as keyof typeof systemPromptTemplates]
                          }
                        });
                      }
                    }}
                  >
                    <SelectTrigger className="h-6 text-xs w-auto">
                      <SelectValue placeholder="Use template" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="task_coordinator">Team Coordinator (Delegation)</SelectItem>
                      <SelectItem value="general_assistant">General Assistant</SelectItem>
                      <SelectItem value="creative_ideator">Creative Ideator</SelectItem>
                      <SelectItem value="analytical_specialist">Analytical Specialist</SelectItem>
                      <SelectItem value="technical_expert">Technical Expert</SelectItem>
                      <SelectItem value="tool_expert_en">Tool Expert (English)</SelectItem>
                      <SelectItem value="tool_expert_ko">Tool Expert (한국어)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Textarea
                  value={agentDraft.defaultModel.systemMessage || ''}
                  onChange={(e) => setAgentDraft({
                    ...agentDraft,
                    defaultModel: { ...agentDraft.defaultModel, systemMessage: e.target.value }
                  })}
                  className="min-h-[100px] text-xs resize-none"
                  placeholder="You are a helpful AI assistant..."
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAgentDraft(null);
                closeModal();
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleAgentSubmit}>
              Create
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Tool Modal */}
      <Modal
        isOpen={isModalOpen('addTool')}
        onClose={() => {
          closeModal();
        }}
        title="Add Tool"
        size="md"
      >
        <div className="p-6 space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={toolDraft.name}
              onChange={(e) => setToolDraft({ ...toolDraft, name: e.target.value })}
              className="h-8 text-xs"
              placeholder="Tool name"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={toolDraft.description}
              onChange={(e) => setToolDraft({ ...toolDraft, description: e.target.value })}
              className="min-h-[90px] text-xs resize-none"
              placeholder="Short description"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                closeModal();
              }}
              type="button"
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmitAddTool} type="button">
              Create
            </Button>
          </div>
        </div>
      </Modal>

      {/* Chat Modal */}
      <Modal
        isOpen={isModalOpen('chat')}
        onClose={() => {
          setChatAgentId(null);
          setChatNodeData(null);
          closeModal();
        }}
        title="Chat Input"
        size="lg"
      >
        <div className="p-6 space-y-3">
          {chatAgentId && (
            <div className="text-sm text-gray-600">
              Target: <span className="font-medium">AGENT — {chatAgentId}</span>
            </div>
          )}
          <ChatInputPanel
            onClose={() => {
              setChatAgentId(null);
              setChatNodeData(null);
              closeModal();
            }}
          />
        </div>
      </Modal>
    </div>
  );
}

export function PlaygroundApp(props: {
  createEventService: (workflowSubscriber: WorkflowEventSubscriber, logger: SimpleLogger) => EventService;
}): React.ReactElement {
  return (
    <>
      <Toaster />
      <PlaygroundProvider defaultServerUrl="ws://localhost:3001/ws" createEventService={props.createEventService}>
        <PlaygroundContent />
      </PlaygroundProvider>
    </>
  );
}


