"use client";

import React, { useState, useEffect } from 'react';
import { Search, Plus, Trash2, Download, Upload, FolderOpen, Calendar, Code, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProjectManager, type Project } from '@/lib/playground/project-manager';
import { useToast } from '../../hooks/use-toast';

interface ProjectBrowserProps {
    onSelectProject: (project: Project) => void;
    onCreateNew: () => void;
    currentProjectId?: string;
}

export function ProjectBrowser({ onSelectProject, onCreateNew, currentProjectId }: ProjectBrowserProps) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'name' | 'created' | 'modified'>('modified');
    const [filterProvider, setFilterProvider] = useState<string>('all');
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
    const [newProject, setNewProject] = useState<{
        name: string
        description: string
        provider: 'openai' | 'anthropic' | 'google'
    }>({
        name: '',
        description: '',
        provider: 'openai'
    });
    const [importData, setImportData] = useState('');

    const { toast } = useToast();

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = () => {
        setProjects(ProjectManager.getInstance().getAllProjects());
    };

    const filteredAndSortedProjects = projects
        .filter(project => {
            const matchesSearch = project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (project.description || '').toLowerCase().includes(searchTerm.toLowerCase());
            const matchesProvider = filterProvider === 'all' || project.provider === filterProvider;
            return matchesSearch && matchesProvider;
        })
        .sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'created':
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                case 'modified':
                    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                default:
                    return 0;
            }
        });

    const handleCreateProject = () => {
        if (!newProject.name.trim()) {
            toast({
                title: "Error",
                description: "Project name is required",
                variant: "destructive"
            });
            return;
        }

        const projectManager = ProjectManager.getInstance();
        const project = projectManager.createProject(
            newProject.name,
            newProject.description,
            { provider: newProject.provider }
        );

        setProjects(projectManager.getAllProjects());
        onSelectProject(project);
        setIsCreateDialogOpen(false);
        setNewProject({ name: '', description: '', provider: 'openai' });

        toast({
            title: "Success",
            description: "Project created successfully"
        });
    };

    const handleDeleteProject = (projectId: string, projectName: string) => {
        if (window.confirm(`Are you sure you want to delete "${projectName}"?`)) {
            ProjectManager.getInstance().deleteProject(projectId);
            setProjects(ProjectManager.getInstance().getAllProjects());

            toast({
                title: "Success",
                description: "Project deleted successfully"
            });
        }
    };

    const handleExportProject = (project: Project) => {
        const dataStr = JSON.stringify(project, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
        link.click();
        URL.revokeObjectURL(url);

        toast({
            title: "Success",
            description: "Project exported successfully"
        });
    };

    const handleImportProject = () => {
        try {
            const projectData = JSON.parse(importData);
            const projectManager = ProjectManager.getInstance();
            const imported = projectManager.importProject(projectData);

            setProjects(projectManager.getAllProjects());
            onSelectProject(imported);
            setIsImportDialogOpen(false);
            setImportData('');

            toast({
                title: "Success",
                description: "Project imported successfully"
            });
        } catch (error) {
            toast({
                title: "Error",
                description: "Invalid project data",
                variant: "destructive"
            });
        }
    };

    const getProviderIcon = (provider: string) => {
        switch (provider) {
            case 'openai': return '🤖';
            case 'anthropic': return '🧠';
            case 'google': return '🔍';
            default: return '⚡';
        }
    };

    const formatDate = (date: string | Date) => {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        return dateObj.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold">Projects</h2>
                    <p className="text-muted-foreground">
                        Manage your Robota playground projects
                    </p>
                </div>
                <div className="flex space-x-2">
                    <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                                <Upload className="w-4 h-4 mr-2" />
                                Import
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Import Project</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="import-data">Project JSON Data</Label>
                                    <Textarea
                                        id="import-data"
                                        placeholder="Paste your project JSON data here..."
                                        value={importData}
                                        onChange={(e) => setImportData(e.target.value)}
                                        rows={10}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={handleImportProject}>Import</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm">
                                <Plus className="w-4 h-4 mr-2" />
                                New Project
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create New Project</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="project-name">Project Name</Label>
                                    <Input
                                        id="project-name"
                                        placeholder="Enter project name..."
                                        value={newProject.name}
                                        onChange={(e) => setNewProject(prev => ({ ...prev, name: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="project-description">Description</Label>
                                    <Textarea
                                        id="project-description"
                                        placeholder="Enter project description..."
                                        value={newProject.description}
                                        onChange={(e) => setNewProject(prev => ({ ...prev, description: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="project-provider">AI Provider</Label>
                                    <Select
                                        value={newProject.provider}
                                        onValueChange={(value: 'openai' | 'anthropic' | 'google') =>
                                            setNewProject(prev => ({ ...prev, provider: value }))
                                        }
                                    >
                                        <SelectTrigger>
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
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={handleCreateProject}>Create</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Filters and Search */}
            <div className="flex items-center space-x-4">
                <div className="flex-1">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                        <Input
                            placeholder="Search projects..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                </div>
                <Select value={sortBy} onValueChange={(value: 'name' | 'created' | 'modified') => setSortBy(value)}>
                    <SelectTrigger className="w-40">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="modified">Last Modified</SelectItem>
                        <SelectItem value="created">Date Created</SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={filterProvider} onValueChange={setFilterProvider}>
                    <SelectTrigger className="w-32">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Providers</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Project Grid */}
            <ScrollArea className="h-[600px]">
                {filteredAndSortedProjects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold mb-2">No projects found</h3>
                        <p className="text-muted-foreground mb-4">
                            {searchTerm ? 'Try adjusting your search or filters' : 'Create your first project to get started'}
                        </p>
                        <Button onClick={onCreateNew}>
                            <Plus className="w-4 h-4 mr-2" />
                            Create New Project
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredAndSortedProjects.map((project) => (
                            <Card
                                key={project.id}
                                className={`cursor-pointer transition-all hover:shadow-md ${currentProjectId === project.id ? 'ring-2 ring-primary' : ''
                                    }`}
                                onClick={() => onSelectProject(project)}
                            >
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <CardTitle className="text-base line-clamp-1">{project.name}</CardTitle>
                                            <div className="flex items-center space-x-2 mt-1">
                                                <Badge variant="secondary" className="text-xs">
                                                    {getProviderIcon(project.provider)} {project.provider}
                                                </Badge>
                                                {currentProjectId === project.id && (
                                                    <Badge variant="default" className="text-xs">Current</Badge>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex space-x-1" onClick={(e) => e.stopPropagation()}>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleExportProject(project)}
                                                className="h-8 w-8 p-0"
                                            >
                                                <Download className="w-3 h-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDeleteProject(project.id, project.name)}
                                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-0">
                                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                                        {project.description || 'No description'}
                                    </p>
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <div className="flex items-center space-x-1">
                                            <Calendar className="w-3 h-3" />
                                            <span>{formatDate(project.updatedAt)}</span>
                                        </div>
                                        <div className="flex items-center space-x-1">
                                            <Code className="w-3 h-3" />
                                            <span>{project.code.split('\n').length} lines</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
} 