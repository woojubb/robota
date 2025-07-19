"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, Eye, EyeOff, Trash2, Plus, Key } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ApiKey {
    id: string;
    name: string;
    key?: string;
    permissions: string[];
    isActive: boolean;
    usageCount: number;
    rateLimit: {
        requestsPerMinute: number;
        requestsPerDay: number;
    };
    createdAt: Date;
    lastUsed?: Date;
}

export default function ApiKeysPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showKey, setShowKey] = useState<Record<string, boolean>>({});
    const [newKeyName, setNewKeyName] = useState("");
    const [newKeyDialogOpen, setNewKeyDialogOpen] = useState(false);
    const [newlyCreatedKey, setNewlyCreatedKey] = useState<ApiKey | null>(null);

    useEffect(() => {
        if (user) {
            fetchApiKeys();
        }
    }, [user]);

    const fetchApiKeys = async () => {
        try {
            setLoading(true);
            // TODO: Replace with actual API call to Firebase Functions
            // For now, use mock data
            const mockApiKeys: ApiKey[] = [
                {
                    id: "robota_123...abc",
                    name: "Development Key",
                    permissions: ["chat.completions"],
                    isActive: true,
                    usageCount: 150,
                    rateLimit: {
                        requestsPerMinute: 60,
                        requestsPerDay: 1000,
                    },
                    createdAt: new Date("2024-01-15"),
                    lastUsed: new Date("2024-01-19"),
                },
            ];
            setApiKeys(mockApiKeys);
        } catch (error) {
            console.error("Error fetching API keys:", error);
            toast({
                title: "Error",
                description: "Failed to fetch API keys",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const createApiKey = async () => {
        if (!newKeyName.trim()) {
            toast({
                title: "Error",
                description: "Please enter a name for your API key",
                variant: "destructive",
            });
            return;
        }

        try {
            setCreating(true);

            // TODO: Replace with actual API call
            const mockNewKey: ApiKey = {
                id: `robota_${Math.random().toString(36).substring(2)}`,
                name: newKeyName,
                key: `robota_${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`,
                permissions: ["chat.completions"],
                isActive: true,
                usageCount: 0,
                rateLimit: {
                    requestsPerMinute: 60,
                    requestsPerDay: 1000,
                },
                createdAt: new Date(),
            };

            setApiKeys(prev => [...prev, mockNewKey]);
            setNewlyCreatedKey(mockNewKey);
            setNewKeyName("");
            setNewKeyDialogOpen(false);

            toast({
                title: "Success",
                description: "API key created successfully",
            });
        } catch (error) {
            console.error("Error creating API key:", error);
            toast({
                title: "Error",
                description: "Failed to create API key",
                variant: "destructive",
            });
        } finally {
            setCreating(false);
        }
    };

    const deleteApiKey = async (keyId: string) => {
        try {
            // TODO: Replace with actual API call
            setApiKeys(prev => prev.filter(key => key.id !== keyId));

            toast({
                title: "Success",
                description: "API key deleted successfully",
            });
        } catch (error) {
            console.error("Error deleting API key:", error);
            toast({
                title: "Error",
                description: "Failed to delete API key",
                variant: "destructive",
            });
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast({
            title: "Copied",
            description: "API key copied to clipboard",
        });
    };

    const toggleKeyVisibility = (keyId: string) => {
        setShowKey(prev => ({
            ...prev,
            [keyId]: !prev[keyId],
        }));
    };

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    };

    if (!user) {
        return (
            <div className="container mx-auto px-4 py-8">
                <Card>
                    <CardContent className="pt-6">
                        <p className="text-center text-muted-foreground">
                            Please sign in to manage your API keys.
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 max-w-6xl">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
                    <p className="text-muted-foreground mt-2">
                        Create and manage API keys to access the Robota API
                    </p>
                </div>

                <Dialog open={newKeyDialogOpen} onOpenChange={setNewKeyDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            Create API Key
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create New API Key</DialogTitle>
                            <DialogDescription>
                                Give your API key a descriptive name to help you identify it later.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="keyName">API Key Name</Label>
                                <Input
                                    id="keyName"
                                    placeholder="e.g., Development Key"
                                    value={newKeyName}
                                    onChange={(e) => setNewKeyName(e.target.value)}
                                />
                            </div>
                            <div className="flex justify-end space-x-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setNewKeyDialogOpen(false)}
                                >
                                    Cancel
                                </Button>
                                <Button onClick={createApiKey} disabled={creating}>
                                    {creating ? "Creating..." : "Create Key"}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Show newly created key */}
            {newlyCreatedKey && (
                <Card className="mb-6 border-green-200 bg-green-50">
                    <CardHeader>
                        <CardTitle className="text-green-800">API Key Created Successfully!</CardTitle>
                        <CardDescription className="text-green-700">
                            Make sure to copy your API key now. You won&apos;t be able to see it again!
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center space-x-2 p-3 bg-white rounded border">
                            <Key className="h-4 w-4 text-green-600" />
                            <code className="flex-1 text-sm font-mono">
                                {newlyCreatedKey.key}
                            </code>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => copyToClipboard(newlyCreatedKey.key!)}
                            >
                                <Copy className="h-4 w-4" />
                            </Button>
                        </div>
                        <Button
                            className="mt-3"
                            variant="outline"
                            onClick={() => setNewlyCreatedKey(null)}
                        >
                            I&apos;ve saved my key
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* API Keys List */}
            <div className="space-y-4">
                {loading ? (
                    <Card>
                        <CardContent className="pt-6">
                            <p className="text-center text-muted-foreground">Loading API keys...</p>
                        </CardContent>
                    </Card>
                ) : apiKeys.length === 0 ? (
                    <Card>
                        <CardContent className="pt-6 text-center">
                            <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                            <h3 className="text-lg font-semibold mb-2">No API Keys</h3>
                            <p className="text-muted-foreground mb-4">
                                Create your first API key to get started with the Robota API
                            </p>
                            <Button onClick={() => setNewKeyDialogOpen(true)}>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Your First API Key
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    apiKeys.map((apiKey) => (
                        <Card key={apiKey.id}>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="text-lg">{apiKey.name}</CardTitle>
                                        <CardDescription>
                                            Created {formatDate(apiKey.createdAt)}
                                            {apiKey.lastUsed && ` • Last used ${formatDate(apiKey.lastUsed)}`}
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Badge variant={apiKey.isActive ? "default" : "secondary"}>
                                            {apiKey.isActive ? "Active" : "Inactive"}
                                        </Badge>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="outline" size="sm">
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete API Key</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Are you sure you want to delete &quot;{apiKey.name}&quot;?
                                                        This action cannot be undone and will immediately invalidate the key.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => deleteApiKey(apiKey.id)}
                                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                    >
                                                        Delete Key
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {/* API Key Display */}
                                    <div>
                                        <Label className="text-sm font-medium">API Key</Label>
                                        <div className="flex items-center space-x-2 mt-1">
                                            <code className="flex-1 p-2 bg-muted rounded text-sm font-mono">
                                                {showKey[apiKey.id] ? (apiKey.key || apiKey.id) : apiKey.id}
                                            </code>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => toggleKeyVisibility(apiKey.id)}
                                            >
                                                {showKey[apiKey.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => copyToClipboard(apiKey.key || apiKey.id)}
                                            >
                                                <Copy className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Usage Stats */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div>
                                            <Label className="text-sm font-medium">Usage Count</Label>
                                            <p className="text-lg font-semibold">{apiKey.usageCount.toLocaleString()}</p>
                                        </div>
                                        <div>
                                            <Label className="text-sm font-medium">Rate Limit/min</Label>
                                            <p className="text-lg font-semibold">{apiKey.rateLimit.requestsPerMinute}</p>
                                        </div>
                                        <div>
                                            <Label className="text-sm font-medium">Rate Limit/day</Label>
                                            <p className="text-lg font-semibold">{apiKey.rateLimit.requestsPerDay.toLocaleString()}</p>
                                        </div>
                                        <div>
                                            <Label className="text-sm font-medium">Permissions</Label>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {apiKey.permissions.map((permission) => (
                                                    <Badge key={permission} variant="outline" className="text-xs">
                                                        {permission}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            {/* API Documentation */}
            <Card className="mt-8">
                <CardHeader>
                    <CardTitle>Getting Started</CardTitle>
                    <CardDescription>
                        Learn how to use your API keys with the Robota API
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <h4 className="font-semibold mb-2">Authentication</h4>
                        <p className="text-sm text-muted-foreground mb-2">
                            Include your API key in the Authorization header:
                        </p>
                        <code className="block p-3 bg-muted rounded text-sm">
                            curl -H &quot;Authorization: Bearer YOUR_API_KEY&quot; \<br />
                            &nbsp;&nbsp;&nbsp;&nbsp;https://api.robota.dev/v1/chat/completions
                        </code>
                    </div>

                    <div>
                        <h4 className="font-semibold mb-2">OpenAI Compatibility</h4>
                        <p className="text-sm text-muted-foreground">
                            Our API is compatible with OpenAI&apos;s API format. You can use existing OpenAI client libraries
                            by changing the base URL to <code className="px-1 py-0.5 bg-muted rounded">https://api.robota.dev/v1</code>
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
} 