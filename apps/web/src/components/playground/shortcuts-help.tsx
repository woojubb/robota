"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Keyboard, Command, Save, Play, FileText, Search, Zap } from 'lucide-react';

interface ShortcutItem {
    keys: string[];
    description: string;
    category: string;
}

const shortcuts: ShortcutItem[] = [
    // Project Management
    { keys: ['Ctrl', 'S'], description: 'Save current project', category: 'Project' },
    { keys: ['Ctrl', 'N'], description: 'Create new project', category: 'Project' },
    { keys: ['Ctrl', 'O'], description: 'Open project browser', category: 'Project' },
    { keys: ['Ctrl', 'Shift', 'E'], description: 'Export project', category: 'Project' },

    // Code Execution
    { keys: ['Ctrl', 'R'], description: 'Run code', category: 'Execution' },
    { keys: ['Ctrl', 'Enter'], description: 'Quick run (from editor)', category: 'Execution' },

    // Navigation
    { keys: ['Ctrl', 'T'], description: 'Open template gallery', category: 'Navigation' },
    { keys: ['Ctrl', 'Tab'], description: 'Switch to next tab', category: 'Navigation' },
    { keys: ['Ctrl', 'Shift', 'Tab'], description: 'Switch to previous tab', category: 'Navigation' },
    { keys: ['Escape'], description: 'Close dialogs and panels', category: 'Navigation' },

    // Editor
    { keys: ['Ctrl', 'F'], description: 'Search in code', category: 'Editor' },
    { keys: ['Ctrl', 'Shift', 'F'], description: 'Format code', category: 'Editor' },
    { keys: ['Ctrl', '/'], description: 'Toggle comments', category: 'Editor' },
    { keys: ['Ctrl', 'Z'], description: 'Undo', category: 'Editor' },
    { keys: ['Ctrl', 'Y'], description: 'Redo', category: 'Editor' },

    // Productivity
    { keys: ['Ctrl', '\\'], description: 'Toggle sidebar', category: 'Productivity' },
    { keys: ['F1'], description: 'Show keyboard shortcuts', category: 'Productivity' },
    { keys: ['Alt', '1'], description: 'Switch to Editor tab', category: 'Productivity' },
    { keys: ['Alt', '2'], description: 'Switch to Projects tab', category: 'Productivity' },
    { keys: ['Alt', '3'], description: 'Switch to Templates tab', category: 'Productivity' },
];

const categories = {
    'Project': { icon: Save, color: 'bg-blue-500' },
    'Execution': { icon: Play, color: 'bg-green-500' },
    'Navigation': { icon: Command, color: 'bg-purple-500' },
    'Editor': { icon: FileText, color: 'bg-orange-500' },
    'Productivity': { icon: Zap, color: 'bg-pink-500' }
};

const KeyBadge = ({ keyCombo }: { keyCombo: string[] }) => (
    <div className="flex items-center space-x-1">
        {keyCombo.map((key, index) => (
            <React.Fragment key={index}>
                <Badge variant="outline" className="font-mono text-xs px-2 py-1">
                    {key}
                </Badge>
                {index < keyCombo.length - 1 && (
                    <span className="text-muted-foreground text-xs">+</span>
                )}
            </React.Fragment>
        ))}
    </div>
);

interface ShortcutsHelpProps {
    trigger?: React.ReactNode;
}

export function ShortcutsHelp({ trigger }: ShortcutsHelpProps) {
    const groupedShortcuts = shortcuts.reduce((acc, shortcut) => {
        if (!acc[shortcut.category]) {
            acc[shortcut.category] = [];
        }
        acc[shortcut.category].push(shortcut);
        return acc;
    }, {} as Record<string, ShortcutItem[]>);

    const defaultTrigger = (
        <Button variant="ghost" size="sm">
            <Keyboard className="w-4 h-4 mr-2" />
            Shortcuts
        </Button>
    );

    return (
        <Dialog>
            <DialogTrigger asChild>
                {trigger || defaultTrigger}
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center space-x-2">
                        <Keyboard className="w-5 h-5" />
                        <span>Keyboard Shortcuts</span>
                    </DialogTitle>
                </DialogHeader>

                <ScrollArea className="h-[600px] pr-4">
                    <div className="space-y-6">
                        {Object.entries(groupedShortcuts).map(([category, categoryShortcuts]) => {
                            const CategoryIcon = categories[category as keyof typeof categories]?.icon || Command;
                            const categoryColor = categories[category as keyof typeof categories]?.color || 'bg-gray-500';

                            return (
                                <Card key={category}>
                                    <CardHeader className="pb-3">
                                        <CardTitle className="flex items-center space-x-2 text-lg">
                                            <div className={`w-8 h-8 rounded-lg ${categoryColor} flex items-center justify-center`}>
                                                <CategoryIcon className="w-4 h-4 text-white" />
                                            </div>
                                            <span>{category}</span>
                                        </CardTitle>
                                        <CardDescription>
                                            {category === 'Project' && 'Manage your projects and files'}
                                            {category === 'Execution' && 'Run and test your agent code'}
                                            {category === 'Navigation' && 'Navigate between different views'}
                                            {category === 'Editor' && 'Code editing and formatting'}
                                            {category === 'Productivity' && 'Boost your development workflow'}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid gap-3">
                                            {categoryShortcuts.map((shortcut, index) => (
                                                <div
                                                    key={index}
                                                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                                                >
                                                    <span className="text-sm font-medium text-foreground flex-1">
                                                        {shortcut.description}
                                                    </span>
                                                    <KeyBadge keyCombo={shortcut.keys} />
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}

                        {/* Tips Section */}
                        <Card className="border-dashed">
                            <CardHeader>
                                <CardTitle className="flex items-center space-x-2 text-lg">
                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center">
                                        <Search className="w-4 h-4 text-white" />
                                    </div>
                                    <span>Pro Tips</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3 text-sm text-muted-foreground">
                                    <div className="flex items-start space-x-2">
                                        <span className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0"></span>
                                        <p>Press <Badge variant="outline" className="mx-1">F1</Badge> anytime to open this shortcuts dialog</p>
                                    </div>
                                    <div className="flex items-start space-x-2">
                                        <span className="w-2 h-2 rounded-full bg-green-500 mt-2 flex-shrink-0"></span>
                                        <p>Use <Badge variant="outline" className="mx-1">Ctrl+Enter</Badge> in the code editor for quick execution</p>
                                    </div>
                                    <div className="flex items-start space-x-2">
                                        <span className="w-2 h-2 rounded-full bg-purple-500 mt-2 flex-shrink-0"></span>
                                        <p>Most shortcuts work globally, even when focused on different elements</p>
                                    </div>
                                    <div className="flex items-start space-x-2">
                                        <span className="w-2 h-2 rounded-full bg-orange-500 mt-2 flex-shrink-0"></span>
                                        <p>Press <Badge variant="outline" className="mx-1">Escape</Badge> to quickly close dialogs and return to coding</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
} 