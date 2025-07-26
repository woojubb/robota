'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { debugStorageInfo, isLocalStorageAvailable } from '@/lib/storage-check';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronUp, ChevronDown, Bug } from 'lucide-react';

export function AuthDebug() {
    const { user, loading, authInitialized } = useAuth();
    const [storageAvailable, setStorageAvailable] = useState(false);
    const [firebaseKeys, setFirebaseKeys] = useState<string[]>([]);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        setStorageAvailable(isLocalStorageAvailable());

        if (isLocalStorageAvailable()) {
            const keys = Object.keys(localStorage).filter(key =>
                key.includes('firebase') || key.includes('auth')
            );
            setFirebaseKeys(keys);
        }
    }, []);

    const handleDebugStorage = () => {
        debugStorageInfo();
    };

    const handleClearStorage = () => {
        if (confirm('Clear all Firebase storage? This will log you out.')) {
            const firebaseKeys = Object.keys(localStorage).filter(key =>
                key.includes('firebase') || key.includes('auth')
            );

            firebaseKeys.forEach(key => {
                localStorage.removeItem(key);
            });

            window.location.reload();
        }
    };

    const toggleExpanded = () => {
        setIsExpanded(!isExpanded);
    };

    // Only show in development
    if (process.env.NODE_ENV !== 'development') {
        return null;
    }

    return (
        <Card className={`fixed bottom-4 right-4 z-50 border-yellow-500 bg-yellow-50 dark:bg-yellow-950 transition-all duration-300 ${isExpanded ? 'w-80' : 'w-auto'
            }`}>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 cursor-pointer" onClick={toggleExpanded}>
                    <Bug className="w-4 h-4" />
                    {isExpanded ? (
                        <>
                            Auth Debug
                            <Badge variant={storageAvailable ? "default" : "destructive"}>
                                Storage: {storageAvailable ? "OK" : "Error"}
                            </Badge>
                            <Badge variant={authInitialized ? "default" : "secondary"}>
                                Init: {authInitialized ? "✓" : "..."}
                            </Badge>
                            <ChevronDown className="w-4 h-4 ml-auto" />
                        </>
                    ) : (
                        <>
                            <span className="text-xs">Debug</span>
                            <Badge
                                variant={loading ? "secondary" : user ? "default" : "destructive"}
                                className="text-xs px-1 py-0"
                            >
                                {loading ? "..." : user ? "✓" : "✗"}
                            </Badge>
                            <ChevronUp className="w-4 h-4" />
                        </>
                    )}
                </CardTitle>
            </CardHeader>

            {isExpanded && (
                <CardContent className="space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <strong>Auth Status:</strong>
                            <div className={`${loading ? 'text-yellow-600' : user ? 'text-green-600' : 'text-red-600'}`}>
                                {loading ? 'Loading...' : user ? 'Authenticated' : 'Not Authenticated'}
                            </div>
                        </div>
                        <div>
                            <strong>Initialized:</strong>
                            <div className={authInitialized ? 'text-green-600' : 'text-yellow-600'}>
                                {authInitialized ? 'Yes' : 'No'}
                            </div>
                        </div>
                    </div>

                    <div>
                        <strong>User:</strong>
                        <div className="truncate">
                            {user ? user.email : 'None'}
                        </div>
                    </div>

                    <div>
                        <strong>Firebase Keys ({firebaseKeys.length}):</strong>
                        <div className="max-h-20 overflow-y-auto text-xs">
                            {firebaseKeys.length > 0 ? (
                                firebaseKeys.map(key => (
                                    <div key={key} className="truncate text-gray-600">
                                        {key.split(':').pop()}
                                    </div>
                                ))
                            ) : (
                                <div className="text-red-600">No Firebase keys found</div>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-1">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleDebugStorage}
                            className="flex-1 text-xs"
                        >
                            Debug
                        </Button>
                        <Button
                            size="sm"
                            variant="destructive"
                            onClick={handleClearStorage}
                            className="flex-1 text-xs"
                        >
                            Clear
                        </Button>
                    </div>
                </CardContent>
            )}
        </Card>
    );
} 