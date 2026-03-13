"use client";

const MAX_VISIBLE_FEATURES = 3;
const CODE_PREVIEW_LENGTH = 500;

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '../ui/dialog';
import {
    Search,
    ArrowRight,
    Clock,
    Users
} from 'lucide-react';
import { ProjectManager } from '../../lib/playground/project-manager';
import type { TPlaygroundProvider } from '../../lib/playground/project-manager';
import { useToast } from '../../hooks/use-toast';
import {
    templates,
    categoryIcons,
    providerIcons,
    difficultyColors,
    type ITemplate,
    type ITemplateGalleryProps
} from './template-gallery-data';

export function TemplateGallery({ onSelectTemplate, onClose }: ITemplateGalleryProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [selectedProvider, setSelectedProvider] = useState<TPlaygroundProvider | 'all'>('all');
    const [selectedTemplate, setSelectedTemplate] = useState<ITemplate | null>(null);
    const { toast } = useToast();

    const handleSelectedProviderChange = (value: string) => {
        if (value === 'all') {
            setSelectedProvider('all');
            return;
        }
        if (value !== 'openai' && value !== 'anthropic' && value !== 'google') {
            throw new Error(`[PLAYGROUND] Invalid provider filter value: "${value}"`);
        }
        setSelectedProvider(value);
    };

    const filteredTemplates = useMemo(() => templates.filter(template => {
        const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            template.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
            template.useCases.some(useCase => useCase.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
        const matchesProvider = selectedProvider === 'all' || template.provider === selectedProvider;

        return matchesSearch && matchesCategory && matchesProvider;
    }), [searchTerm, selectedCategory, selectedProvider]);

    const handleUseTemplate = (template: ITemplate) => {
        onSelectTemplate(template);
        onClose?.();

        toast({
            title: "Template Applied",
            description: `"${template.name}" has been loaded successfully`
        });
    };

    const handleCreateProject = (template: ITemplate) => {
        const projectManager = ProjectManager.getInstance();
        const project = projectManager.createProject(
            template.name,
            template.description,
            {
                provider: template.provider,
                model: template.config.model,
                temperature: template.config.temperature
            }
        );

        projectManager.updateProject(project.id, {
            code: template.code
        });

        onSelectTemplate({
            ...template,
            code: template.code
        });
        onClose?.();

        toast({
            title: "Project Created",
            description: `New project "${template.name}" created from template`
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold mb-2">Template Gallery</h2>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                    Kickstart your AI agent development with our curated collection of templates.
                    Choose from basic chat bots to advanced multi-modal assistants.
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                        <Input
                            placeholder="Search templates..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                </div>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        <SelectItem value="basic">Basic</SelectItem>
                        <SelectItem value="tools">Tools</SelectItem>
                        <SelectItem value="creative">Creative</SelectItem>
                        <SelectItem value="business">Business</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={selectedProvider} onValueChange={handleSelectedProviderChange}>
                    <SelectTrigger className="w-32">
                        <SelectValue placeholder="Provider" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Providers</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Results Info */}
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''} found
                </p>
            </div>

            {/* Template Grid */}
            <ScrollArea className="h-[600px]">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredTemplates.map((template) => {
                        const CategoryIcon = categoryIcons[template.category];

                        return (
                            <Card key={template.id} className="group hover:shadow-lg transition-all duration-200">
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center space-x-2">
                                            <CategoryIcon className="w-5 h-5 text-primary" />
                                            <Badge className={difficultyColors[template.difficulty]}>
                                                {template.difficulty}
                                            </Badge>
                                        </div>
                                        <Badge variant="secondary" className="text-xs">
                                            {providerIcons[template.provider]} {template.provider}
                                        </Badge>
                                    </div>
                                    <CardTitle className="text-lg">{template.name}</CardTitle>
                                    <CardDescription className="line-clamp-2">
                                        {template.description}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div>
                                        <h4 className="text-sm font-medium mb-2">Features</h4>
                                        <div className="flex flex-wrap gap-1">
                                            {template.features.slice(0, MAX_VISIBLE_FEATURES).map((feature, index) => (
                                                <Badge key={index} variant="outline" className="text-xs">
                                                    {feature}
                                                </Badge>
                                            ))}
                                            {template.features.length > MAX_VISIBLE_FEATURES && (
                                                <Badge variant="outline" className="text-xs">
                                                    +{template.features.length - MAX_VISIBLE_FEATURES} more
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-2 text-xs text-muted-foreground">
                                        <div className="flex items-center space-x-1">
                                            <Clock className="w-3 h-3" />
                                            <span>{template.estimatedTime}</span>
                                        </div>
                                        <div className="flex items-center space-x-1">
                                            <Users className="w-3 h-3" />
                                            <span>{template.useCases[0]}</span>
                                            {template.useCases.length > 1 && (
                                                <span>+{template.useCases.length - 1} more</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex space-x-2 pt-2">
                                        <Button
                                            size="sm"
                                            onClick={() => handleUseTemplate(template)}
                                            className="flex-1"
                                        >
                                            Use Template
                                            <ArrowRight className="w-3 h-3 ml-1" />
                                        </Button>
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button size="sm" variant="outline" onClick={() => setSelectedTemplate(template)}>
                                                    Preview
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                                                <DialogHeader>
                                                    <DialogTitle className="flex items-center space-x-2">
                                                        <CategoryIcon className="w-5 h-5" />
                                                        <span>{template.name}</span>
                                                        <Badge className={difficultyColors[template.difficulty]}>
                                                            {template.difficulty}
                                                        </Badge>
                                                    </DialogTitle>
                                                </DialogHeader>
                                                <div className="space-y-4">
                                                    <p className="text-muted-foreground">{template.description}</p>

                                                    <div>
                                                        <h4 className="font-medium mb-2">Features</h4>
                                                        <div className="flex flex-wrap gap-1">
                                                            {template.features.map((feature, index) => (
                                                                <Badge key={index} variant="outline">
                                                                    {feature}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <h4 className="font-medium mb-2">Use Cases</h4>
                                                        <ul className="list-disc list-inside text-sm text-muted-foreground">
                                                            {template.useCases.map((useCase, index) => (
                                                                <li key={index}>{useCase}</li>
                                                            ))}
                                                        </ul>
                                                    </div>

                                                    <div>
                                                        <h4 className="font-medium mb-2">Code Preview</h4>
                                                        <div className="bg-muted p-4 rounded-lg">
                                                            <pre className="text-sm overflow-x-auto">
                                                                <code>{template.code.slice(0, CODE_PREVIEW_LENGTH)}...</code>
                                                            </pre>
                                                        </div>
                                                    </div>
                                                </div>
                                                <DialogFooter>
                                                    <Button variant="outline" onClick={() => handleCreateProject(template)}>
                                                        Create Project
                                                    </Button>
                                                    <Button onClick={() => handleUseTemplate(template)}>
                                                        Use Template
                                                    </Button>
                                                </DialogFooter>
                                            </DialogContent>
                                        </Dialog>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </ScrollArea>
        </div>
    );
}