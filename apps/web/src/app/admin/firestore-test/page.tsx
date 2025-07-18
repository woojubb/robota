'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Database,
    CheckCircle,
    XCircle,
    Loader2,
    Play,
    RefreshCw
} from 'lucide-react';
import {
    testFirestoreConnection,
    testFirestoreWrite,
    testFirestoreRead,
    runAllFirestoreTests
} from '@/lib/firebase/firestore-test';

interface TestResult {
    success: boolean;
    message: string;
    details?: any;
}

export default function FirestoreTestPage() {
    const [isLoading, setIsLoading] = useState(false);
    const [testResults, setTestResults] = useState<{
        connection?: TestResult;
        write?: TestResult;
        read?: TestResult;
    }>({});

    const runConnectionTest = async () => {
        setIsLoading(true);
        try {
            const result = await testFirestoreConnection();
            setTestResults(prev => ({ ...prev, connection: result }));
        } catch (error) {
            setTestResults(prev => ({
                ...prev,
                connection: {
                    success: false,
                    message: 'Connection test failed',
                    details: error
                }
            }));
        } finally {
            setIsLoading(false);
        }
    };

    const runWriteTest = async () => {
        setIsLoading(true);
        try {
            const result = await testFirestoreWrite();
            setTestResults(prev => ({ ...prev, write: result }));
        } catch (error) {
            setTestResults(prev => ({
                ...prev,
                write: {
                    success: false,
                    message: 'Write test failed',
                    details: error
                }
            }));
        } finally {
            setIsLoading(false);
        }
    };

    const runReadTest = async () => {
        setIsLoading(true);
        try {
            const result = await testFirestoreRead();
            setTestResults(prev => ({ ...prev, read: result }));
        } catch (error) {
            setTestResults(prev => ({
                ...prev,
                read: {
                    success: false,
                    message: 'Read test failed',
                    details: error
                }
            }));
        } finally {
            setIsLoading(false);
        }
    };

    const runAllTests = async () => {
        setIsLoading(true);
        setTestResults({});

        try {
            // Run all tests sequentially
            const connectionResult = await testFirestoreConnection();
            setTestResults(prev => ({ ...prev, connection: connectionResult }));

            if (connectionResult.success) {
                const writeResult = await testFirestoreWrite();
                setTestResults(prev => ({ ...prev, write: writeResult }));

                const readResult = await testFirestoreRead();
                setTestResults(prev => ({ ...prev, read: readResult }));
            }

            // Also run the console version for detailed logs
            await runAllFirestoreTests();
        } catch (error) {
            console.error('Error running all tests:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const resetTests = () => {
        setTestResults({});
    };

    const TestResultCard = ({
        title,
        result,
        description
    }: {
        title: string;
        result?: TestResult;
        description: string;
    }) => (
        <Card className="w-full">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{title}</CardTitle>
                    {result && (
                        <Badge
                            variant={result.success ? "default" : "destructive"}
                            className={result.success ? "bg-green-500" : ""}
                        >
                            {result.success ? (
                                <CheckCircle className="h-4 w-4 mr-1" />
                            ) : (
                                <XCircle className="h-4 w-4 mr-1" />
                            )}
                            {result.success ? 'Success' : 'Failed'}
                        </Badge>
                    )}
                </div>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                {result ? (
                    <div className="space-y-2">
                        <p className="text-sm font-medium">{result.message}</p>
                        {result.details && (
                            <div className="bg-muted p-3 rounded-md">
                                <pre className="text-xs overflow-auto">
                                    {JSON.stringify(result.details, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-muted-foreground text-sm">Test not run yet</p>
                )}
            </CardContent>
        </Card>
    );

    return (
        <div className="container mx-auto py-8 px-4">
            <div className="max-w-4xl mx-auto space-y-8">
                {/* Header */}
                <div className="text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 mb-4">
                        <Database className="h-8 w-8" />
                        <h1 className="text-3xl font-bold">Firestore Connection Test</h1>
                    </div>
                    <p className="text-muted-foreground">
                        Test your connection to the robota-io Firestore database
                    </p>
                </div>

                {/* Current Configuration */}
                <Card>
                    <CardHeader>
                        <CardTitle>Current Configuration</CardTitle>
                        <CardDescription>
                            Firebase project settings from environment variables
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                                <span className="font-medium">Project ID:</span>
                                <span className="ml-2 text-muted-foreground">
                                    {process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'Not set'}
                                </span>
                            </div>
                            <div>
                                <span className="font-medium">Auth Domain:</span>
                                <span className="ml-2 text-muted-foreground">
                                    {process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'Not set'}
                                </span>
                            </div>
                            <div>
                                <span className="font-medium">Storage Bucket:</span>
                                <span className="ml-2 text-muted-foreground">
                                    {process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'Not set'}
                                </span>
                            </div>
                            <div>
                                <span className="font-medium">API Key:</span>
                                <span className="ml-2 text-muted-foreground">
                                    {process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? '••••••••' : 'Not set'}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Control Buttons */}
                <div className="flex flex-wrap gap-4 justify-center">
                    <Button
                        onClick={runAllTests}
                        disabled={isLoading}
                        className="min-w-[140px]"
                    >
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Play className="h-4 w-4 mr-2" />
                        )}
                        Run All Tests
                    </Button>

                    <Button
                        variant="outline"
                        onClick={runConnectionTest}
                        disabled={isLoading}
                    >
                        Test Connection
                    </Button>

                    <Button
                        variant="outline"
                        onClick={runWriteTest}
                        disabled={isLoading}
                    >
                        Test Write
                    </Button>

                    <Button
                        variant="outline"
                        onClick={runReadTest}
                        disabled={isLoading}
                    >
                        Test Read
                    </Button>

                    <Button
                        variant="ghost"
                        onClick={resetTests}
                        disabled={isLoading}
                    >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Reset
                    </Button>
                </div>

                {/* Test Results */}
                <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
                    <TestResultCard
                        title="Connection Test"
                        result={testResults.connection}
                        description="Test basic connectivity to Firestore database"
                    />

                    <TestResultCard
                        title="Write Test"
                        result={testResults.write}
                        description="Test ability to write data to Firestore"
                    />

                    <TestResultCard
                        title="Read Test"
                        result={testResults.read}
                        description="Test ability to read data from Firestore"
                    />
                </div>

                {/* Help Information */}
                <Alert>
                    <Database className="h-4 w-4" />
                    <AlertDescription>
                        <strong>Troubleshooting:</strong> If tests fail, check your Firebase project settings,
                        ensure Firestore is enabled, and verify that security rules allow read/write operations.
                        Also check the browser console for detailed error messages.
                    </AlertDescription>
                </Alert>
            </div>
        </div>
    );
} 