'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getAuthConfig, getEnabledProviders, isSocialLoginEnabled } from '@/lib/auth/auth-config';
import { CheckCircle, XCircle, Settings } from 'lucide-react';

export default function AuthConfigPage() {
    const config = getAuthConfig();
    const enabledProviders = getEnabledProviders();
    const socialLoginEnabled = isSocialLoginEnabled();

    const ConfigRow = ({
        label,
        value,
        description
    }: {
        label: string;
        value: boolean;
        description: string;
    }) => (
        <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
                <p className="font-medium">{label}</p>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="flex items-center gap-2">
                {value ? (
                    <>
                        <CheckCircle className="h-5 w-5 text-green-500" />
                        <Badge variant="default" className="bg-green-500">Enabled</Badge>
                    </>
                ) : (
                    <>
                        <XCircle className="h-5 w-5 text-red-500" />
                        <Badge variant="destructive">Disabled</Badge>
                    </>
                )}
            </div>
        </div>
    );

    return (
        <div className="container mx-auto py-8 px-4">
            <div className="max-w-4xl mx-auto space-y-8">
                {/* Header */}
                <div className="text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 mb-4">
                        <Settings className="h-8 w-8" />
                        <h1 className="text-3xl font-bold">Authentication Configuration</h1>
                    </div>
                    <p className="text-muted-foreground">
                        Current authentication settings based on environment variables
                    </p>
                </div>

                {/* Current Status Overview */}
                <Card>
                    <CardHeader>
                        <CardTitle>Configuration Overview</CardTitle>
                        <CardDescription>
                            Current authentication providers status
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <ConfigRow
                            label="Email Login"
                            value={config.enableEmailLogin}
                            description="Standard email and password authentication"
                        />
                        <ConfigRow
                            label="Social Login (Global)"
                            value={config.enableSocialLogin}
                            description="Master switch for all social login providers"
                        />
                        <ConfigRow
                            label="Google Login"
                            value={config.enableGoogleLogin}
                            description="Google OAuth authentication"
                        />
                        <ConfigRow
                            label="GitHub Login"
                            value={config.enableGitHubLogin}
                            description="GitHub OAuth authentication"
                        />
                    </CardContent>
                </Card>

                {/* Enabled Providers */}
                <Card>
                    <CardHeader>
                        <CardTitle>Enabled Providers</CardTitle>
                        <CardDescription>
                            Currently active authentication providers
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {enabledProviders.length > 0 ? (
                            <div className="flex gap-2 flex-wrap">
                                <Badge variant="default">Email</Badge>
                                {enabledProviders.map((provider) => (
                                    <Badge key={provider} variant="secondary" className="capitalize">
                                        {provider}
                                    </Badge>
                                ))}
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <Badge variant="default">Email Only</Badge>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Environment Variables */}
                <Card>
                    <CardHeader>
                        <CardTitle>Environment Variables</CardTitle>
                        <CardDescription>
                            Raw environment variable values (for debugging)
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2 font-mono text-sm">
                            <div className="flex justify-between">
                                <span>NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN:</span>
                                <span className="text-muted-foreground">
                                    {process.env.NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN || 'undefined'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN:</span>
                                <span className="text-muted-foreground">
                                    {process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN || 'undefined'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>NEXT_PUBLIC_ENABLE_GITHUB_LOGIN:</span>
                                <span className="text-muted-foreground">
                                    {process.env.NEXT_PUBLIC_ENABLE_GITHUB_LOGIN || 'undefined'}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>NEXT_PUBLIC_ENABLE_EMAIL_LOGIN:</span>
                                <span className="text-muted-foreground">
                                    {process.env.NEXT_PUBLIC_ENABLE_EMAIL_LOGIN || 'undefined'}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Instructions */}
                <Card>
                    <CardHeader>
                        <CardTitle>How to Enable/Disable Features</CardTitle>
                        <CardDescription>
                            Instructions for controlling authentication features
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 bg-muted rounded-lg">
                            <h4 className="font-medium mb-2">To enable Google Login:</h4>
                            <code className="text-sm">NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=true</code><br />
                            <code className="text-sm">NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=true</code>
                        </div>
                        <div className="p-4 bg-muted rounded-lg">
                            <h4 className="font-medium mb-2">To enable GitHub Login:</h4>
                            <code className="text-sm">NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=true</code><br />
                            <code className="text-sm">NEXT_PUBLIC_ENABLE_GITHUB_LOGIN=true</code>
                        </div>
                        <div className="p-4 bg-muted rounded-lg">
                            <h4 className="font-medium mb-2">To disable all social logins:</h4>
                            <code className="text-sm">NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=false</code>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
} 