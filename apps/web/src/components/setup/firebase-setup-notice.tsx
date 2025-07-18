'use client';

import { useState, useEffect } from 'react';
import { validateFirebaseConfig, FirebaseConfigStatus } from '@/lib/firebase/config-validator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    AlertTriangle,
    CheckCircle,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    Copy,
    Settings
} from 'lucide-react';

export function FirebaseSetupNotice() {
    const [configStatus, setConfigStatus] = useState<FirebaseConfigStatus | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        // Only run on client side
        const status = validateFirebaseConfig();
        setConfigStatus(status);

        // Auto-expand if there are missing variables
        if (!status.isValid) {
            setIsExpanded(true);
        }
    }, []);

    const copyEnvTemplate = async () => {
        const template = `# Firebase Configuration
# Get these values from your Firebase project settings
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_firebase_app_id

# Google Analytics Configuration (optional)
NEXT_PUBLIC_GA_TRACKING_ID=G-XXXXXXXXXX

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Robota SDK`;

        try {
            await navigator.clipboard.writeText(template);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Don't render anything if we haven't checked the config yet
    if (!configStatus) return null;

    // Don't render if everything is configured properly
    if (configStatus.isValid && configStatus.warnings.length === 0) return null;

    return (
        <div className="p-4 border-b bg-muted/30">
            <Alert className={configStatus.isValid ? 'border-yellow-200 bg-yellow-50' : 'border-red-200 bg-red-50'}>
                <div className="flex items-center gap-2">
                    {configStatus.isValid ? (
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    ) : (
                        <Settings className="h-4 w-4 text-red-600" />
                    )}
                    <AlertTitle className="mb-0">
                        {configStatus.isValid ? 'Configuration Warnings' : 'Firebase Setup Required'}
                    </AlertTitle>
                </div>

                <AlertDescription className="mt-2">
                    {configStatus.isValid ? (
                        <span>Firebase is configured but some optional features need setup.</span>
                    ) : (
                        <span>Firebase environment variables are missing. Please configure them to use authentication and storage features.</span>
                    )}
                </AlertDescription>

                <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className="mt-3">
                    <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="p-0 h-auto font-normal">
                            {isExpanded ? (
                                <ChevronDown className="h-4 w-4 mr-1" />
                            ) : (
                                <ChevronRight className="h-4 w-4 mr-1" />
                            )}
                            {configStatus.isValid ? 'View warnings' : 'Show setup instructions'}
                        </Button>
                    </CollapsibleTrigger>

                    <CollapsibleContent className="mt-3">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Settings className="h-4 w-4" />
                                    Configuration Status
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* Missing Variables */}
                                {configStatus.missingVars.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-medium text-red-800 mb-2">Missing Variables:</h4>
                                        <div className="space-y-1">
                                            {configStatus.missingVars.map(varName => (
                                                <Badge key={varName} variant="destructive" className="mr-2 mb-1">
                                                    {varName}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Warnings */}
                                {configStatus.warnings.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-medium text-yellow-800 mb-2">Warnings:</h4>
                                        <div className="space-y-1">
                                            {configStatus.warnings.map((warning, index) => (
                                                <Badge key={index} variant="outline" className="mr-2 mb-1 border-yellow-300 text-yellow-800">
                                                    {warning}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Setup Instructions */}
                                <div className="border-t pt-4">
                                    <h4 className="text-sm font-medium mb-3">Setup Instructions:</h4>
                                    <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
                                        <li>
                                            Create a Firebase project at{' '}
                                            <Button variant="link" size="sm" className="p-0 h-auto" asChild>
                                                <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer">
                                                    Firebase Console
                                                    <ExternalLink className="h-3 w-3 ml-1" />
                                                </a>
                                            </Button>
                                        </li>
                                        <li>Add a web app to your Firebase project</li>
                                        <li>Copy the configuration values from Firebase</li>
                                        <li>
                                            Create <code className="bg-muted px-1 rounded">.env.local</code> file in{' '}
                                            <code className="bg-muted px-1 rounded">apps/web/</code>
                                        </li>
                                        <li>Paste the configuration values into the file</li>
                                    </ol>

                                    <div className="mt-4 p-3 bg-muted rounded-lg">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium">Environment Template:</span>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={copyEnvTemplate}
                                                className="h-8"
                                            >
                                                {copied ? (
                                                    <CheckCircle className="h-3 w-3 mr-1" />
                                                ) : (
                                                    <Copy className="h-3 w-3 mr-1" />
                                                )}
                                                {copied ? 'Copied!' : 'Copy'}
                                            </Button>
                                        </div>
                                        <pre className="text-xs text-muted-foreground overflow-x-auto">
                                            <code>
                                                {`# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef`}
                                            </code>
                                        </pre>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </CollapsibleContent>
                </Collapsible>
            </Alert>
        </div>
    );
} 