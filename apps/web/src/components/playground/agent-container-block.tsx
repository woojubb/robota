'use client';

/**
 * AgentContainerBlock - Individual Agent in Team Context
 * 
 * This component provides a compact visual representation of an individual
 * Agent within a Team configuration. It's simpler than AgentConfigurationBlock
 * and focuses on team-specific agent properties.
 * 
 * Features:
 * - Compact agent representation
 * - Team role and priority management
 * - Agent status in team context
 * - Quick configuration access
 * - Drag & drop for reordering
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    Bot,
    Settings,
    ChevronDown,
    ChevronRight,
    Edit3,
    Trash2,
    Play,
    Pause,
    CheckCircle,
    AlertCircle,
    Info,
    Crown,
    Shield,
    Users,
    Zap,
    Puzzle,
    GripVertical
} from 'lucide-react';
import type { PlaygroundAgentConfig } from '@/lib/playground/robota-executor';

export interface AgentContainerBlockProps {
    agent: PlaygroundAgentConfig;
    index: number;
    totalAgents: number;
    isActive?: boolean;
    isExecuting?: boolean;
    isLeader?: boolean;
    teamRole?: string;
    priority?: number;
    onAgentChange: (agent: PlaygroundAgentConfig) => void;
    onRemove?: () => void;
    onEdit?: () => void;
    onSetLeader?: () => void;
    onPriorityChange?: (priority: number) => void;
    onRoleChange?: (role: string) => void;
    className?: string;
    draggable?: boolean;
    onDragStart?: (event: React.DragEvent) => void;
    onDragOver?: (event: React.DragEvent) => void;
    onDrop?: (event: React.DragEvent) => void;
}

const TEAM_ROLES = [
    { value: 'coordinator', label: 'Coordinator', icon: Crown, color: 'text-yellow-600' },
    { value: 'specialist', label: 'Specialist', icon: Zap, color: 'text-blue-600' },
    { value: 'validator', label: 'Validator', icon: Shield, color: 'text-green-600' },
    { value: 'assistant', label: 'Assistant', icon: Bot, color: 'text-gray-600' },
    { value: 'monitor', label: 'Monitor', icon: Settings, color: 'text-purple-600' }
];

export function AgentContainerBlock({
    agent,
    index,
    totalAgents,
    isActive = false,
    isExecuting = false,
    isLeader = false,
    teamRole = 'assistant',
    priority = 0,
    onAgentChange,
    onRemove,
    onEdit,
    onSetLeader,
    onPriorityChange,
    onRoleChange,
    className = '',
    draggable = false,
    onDragStart,
    onDragOver,
    onDrop
}: AgentContainerBlockProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    // Get role information
    const roleInfo = useMemo(() => {
        return TEAM_ROLES.find(role => role.value === teamRole) || TEAM_ROLES[3]; // Default to assistant
    }, [teamRole]);

    const RoleIcon = roleInfo.icon;

    // Status indicators
    const statusIcon = useMemo(() => {
        if (isExecuting) return <Play className="h-3 w-3 text-green-500 animate-pulse" />;
        if (isActive) return <CheckCircle className="h-3 w-3 text-green-500" />;
        return <Info className="h-3 w-3 text-gray-400" />;
    }, [isExecuting, isActive]);

    // Handle role change
    const handleRoleChange = useCallback((newRole: string) => {
        onRoleChange?.(newRole);
    }, [onRoleChange]);

    // Handle priority change
    const handlePriorityChange = useCallback((newPriority: number) => {
        onPriorityChange?.(newPriority);
    }, [onPriorityChange]);

    return (
        <Card
            className={`
        relative transition-all duration-200 border
        ${isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}
        ${isExecuting ? 'bg-green-50 border-green-300' : ''}
        ${isLeader ? 'border-yellow-400 bg-yellow-50' : ''}
        ${draggable ? 'cursor-move' : ''}
        ${className}
      `}
            draggable={draggable}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger asChild>
                    <CardHeader className="pb-2 cursor-pointer hover:bg-gray-50">
                        <div className="flex items-center gap-2">
                            {/* Drag Handle */}
                            {draggable && (
                                <GripVertical className="h-3 w-3 text-gray-400 cursor-move" />
                            )}

                            {/* Expand/Collapse */}
                            {isExpanded ? (
                                <ChevronDown className="h-3 w-3 text-gray-400" />
                            ) : (
                                <ChevronRight className="h-3 w-3 text-gray-400" />
                            )}

                            {/* Agent Info */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <RoleIcon className={`h-4 w-4 ${roleInfo.color}`} />
                                <CardTitle className="text-xs font-medium truncate">
                                    {agent.name}
                                </CardTitle>

                                {/* Leader Badge */}
                                {isLeader && (
                                    <Crown className="h-3 w-3 text-yellow-500" />
                                )}

                                {statusIcon}
                            </div>

                            {/* Position Badge */}
                            <Badge variant="outline" className="text-xs px-1 py-0">
                                {index + 1}/{totalAgents}
                            </Badge>
                        </div>

                        {/* Role and Status */}
                        <div className="flex items-center gap-2 text-xs text-gray-500 ml-8">
                            <Badge variant="secondary" className="text-xs">
                                {roleInfo.label}
                            </Badge>
                            <span>•</span>
                            <span>{agent.defaultModel.provider}</span>
                            <span>•</span>
                            <span>{agent.defaultModel.model}</span>
                            {priority > 0 && (
                                <>
                                    <span>•</span>
                                    <span>P{priority}</span>
                                </>
                            )}
                        </div>
                    </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                    <CardContent className="pt-0 pl-8">
                        <div className="space-y-3">
                            {/* Team Configuration */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">Team Role</Label>
                                    <Select
                                        value={teamRole}
                                        onValueChange={handleRoleChange}
                                        disabled={!isEditing}
                                    >
                                        <SelectTrigger className="h-7 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {TEAM_ROLES.map((role) => (
                                                <SelectItem key={role.value} value={role.value}>
                                                    <div className="flex items-center gap-2">
                                                        <role.icon className={`h-3 w-3 ${role.color}`} />
                                                        {role.label}
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-1">
                                    <Label className="text-xs">Priority</Label>
                                    <Input
                                        type="number"
                                        value={priority}
                                        onChange={(e) => handlePriorityChange(parseInt(e.target.value) || 0)}
                                        className="h-7 text-xs"
                                        disabled={!isEditing}
                                        min={0}
                                        max={10}
                                    />
                                </div>
                            </div>

                            {/* Agent Capabilities */}
                            <div className="space-y-2">
                                <Label className="text-xs font-medium">Capabilities</Label>
                                <div className="flex flex-wrap gap-1">
                                    {agent.tools && agent.tools.length > 0 && (
                                        <Badge variant="outline" className="text-xs">
                                            <Zap className="h-2 w-2 mr-1" />
                                            {agent.tools.length} tools
                                        </Badge>
                                    )}
                                    {agent.plugins && agent.plugins.length > 0 && (
                                        <Badge variant="outline" className="text-xs">
                                            <Puzzle className="h-2 w-2 mr-1" />
                                            {agent.plugins.length} plugins
                                        </Badge>
                                    )}
                                    <Badge variant="outline" className="text-xs">
                                        <Bot className="h-2 w-2 mr-1" />
                                        {agent.defaultModel.provider}
                                    </Badge>
                                </div>
                            </div>

                            {/* System Message Preview */}
                            {agent.defaultModel.systemMessage && (
                                <div className="space-y-1">
                                    <Label className="text-xs font-medium">System Message</Label>
                                    <div className="p-2 bg-gray-50 rounded text-xs text-gray-600 max-h-16 overflow-y-auto">
                                        {agent.defaultModel.systemMessage}
                                    </div>
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                                {!isLeader && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSetLeader?.();
                                        }}
                                        className="h-6 px-2 text-xs"
                                    >
                                        <Crown className="h-3 w-3 mr-1" />
                                        Set Leader
                                    </Button>
                                )}

                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsEditing(!isEditing);
                                    }}
                                    className="h-6 px-2 text-xs"
                                >
                                    <Edit3 className="h-3 w-3 mr-1" />
                                    {isEditing ? 'Done' : 'Edit'}
                                </Button>

                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onEdit?.();
                                    }}
                                    className="h-6 px-2 text-xs"
                                >
                                    <Settings className="h-3 w-3 mr-1" />
                                    Configure
                                </Button>

                                <div className="flex-1" />

                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRemove?.();
                                    }}
                                    className="h-6 w-6 p-0 text-red-500"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    );
} 