'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { debugStorageInfo, isLocalStorageAvailable } from '@/lib/storage-check';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function AuthDebug() {
    const { user, loading, authInitialized } = useAuth();
    const [storageAvailable, setStorageAvailable] = useState(false);
    const [firebaseKeys, setFirebaseKeys] = useState<string[]>([]);

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

    // Only show in development
    if (process.env.NODE_ENV !== 'development') {
        return null;
    }

    return (
        <Card className="fixed bottom-4 right-4 w-80 z-50 border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                    🐛 Auth Debug
                    <Badge variant={storageAvailable ? "default" : "destructive"}>
                        Storage: {storageAvailable ? "OK" : "Error"}
                    </Badge>
                    <Badge variant={authInitialized ? "default" : "secondary"}>
                        Init: {authInitialized ? "✓" : "..."}
                    </Badge>
                </CardTitle>
            </CardHeader>
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
        </Card>
    );
} 