'use client';

import React from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import type { IPlaygroundAgentConfig } from '../../lib/playground/robota-executor';
import { systemPromptTemplates } from './system-prompt-templates';
import type { TToolDraft } from './PlaygroundApp';

export function CreateAgentModal({
  isOpen,
  agentDraft,
  setAgentDraft,
  onSubmit,
  onClose,
}: {
  isOpen: boolean;
  agentDraft: IPlaygroundAgentConfig | null;
  setAgentDraft: (draft: IPlaygroundAgentConfig | null) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Agent" size="lg">
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
                  onValueChange={(value) =>
                    setAgentDraft({
                      ...agentDraft,
                      defaultModel: { ...agentDraft.defaultModel, provider: value },
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
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
                    if (value && systemPromptTemplates[value]) {
                      setAgentDraft({
                        ...agentDraft,
                        defaultModel: {
                          ...agentDraft.defaultModel,
                          systemMessage: systemPromptTemplates[value],
                        },
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
                    <SelectItem value="tool_expert_en">Tool Expert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                value={agentDraft.defaultModel.systemMessage || ''}
                onChange={(e) =>
                  setAgentDraft({
                    ...agentDraft,
                    defaultModel: { ...agentDraft.defaultModel, systemMessage: e.target.value },
                  })
                }
                className="min-h-[100px] text-xs resize-none"
                placeholder="You are a helpful AI assistant..."
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmit}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function AddToolModal({
  isOpen,
  toolDraft,
  setToolDraft,
  onSubmit,
  onClose,
}: {
  isOpen: boolean;
  toolDraft: TToolDraft;
  setToolDraft: (draft: TToolDraft) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Tool" size="md">
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
          <Button variant="outline" size="sm" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmit} type="button">
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}
