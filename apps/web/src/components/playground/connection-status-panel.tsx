import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wifi, Settings, User, Hash } from 'lucide-react';
import { usePlayground } from '@/contexts/playground-context';

/**
 * Connection Status Panel Component
 * Shows WebSocket connection status and basic information
 */
export const ConnectionStatusPanel: React.FC = () => {
    const { state } = usePlayground();
    const { serverUrl, userId, sessionId, executor } = state;

    // Simple connection check based on executor availability
    const isConnected = !!executor;

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Settings className="h-4 w-4 text-blue-500" />
                    Playground Status
                    <Badge
                        variant={isConnected ? "default" : "secondary"}
                        className="ml-auto text-xs"
                    >
                        {isConnected ? "Ready" : "Initializing"}
                    </Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                        <Wifi className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-500">Server:</span>
                        <span className="font-mono text-gray-700 truncate">
                            {serverUrl || 'localhost:3001'}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                        <User className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-500">User:</span>
                        <span className="font-mono text-gray-700 truncate">
                            {userId || 'playground-user'}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                        <Hash className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-500">Session:</span>
                        <span className="font-mono text-gray-700 truncate">
                            {sessionId ? sessionId.slice(-8) : 'Not set'}
                        </span>
                    </div>
                </div>

                <div className="pt-2 border-t">
                    <div className="text-xs text-center text-gray-500">
                        {isConnected ? (
                            "🟢 Ready for agent execution"
                        ) : (
                            "🟡 Initializing executor..."
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}; 