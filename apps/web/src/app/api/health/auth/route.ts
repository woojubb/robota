import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/firebase/config';

export async function GET(request: NextRequest) {
    try {
        const startTime = Date.now();

        // Check Firebase Auth configuration
        const authConfig = {
            apiKey: !!auth.app.options.apiKey,
            authDomain: !!auth.app.options.authDomain,
            projectId: !!auth.app.options.projectId,
        };

        // Check if auth is properly initialized
        const isConfigured = authConfig.apiKey && authConfig.authDomain && authConfig.projectId;

        const responseTime = Date.now() - startTime;

        const healthCheck = {
            status: isConfigured ? 'ok' : 'warning',
            timestamp: new Date().toISOString(),
            authentication: {
                status: isConfigured ? 'configured' : 'misconfigured',
                responseTime: `${responseTime}ms`,
                provider: 'firebase-auth',
                features: {
                    emailAuth: true,
                    googleAuth: !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
                    githubAuth: !!process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID,
                },
            },
        };

        return NextResponse.json(healthCheck, {
            status: isConfigured ? 200 : 503,
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            },
        });
    } catch (error) {
        console.error('Authentication health check failed:', error);

        return NextResponse.json(
            {
                status: 'error',
                timestamp: new Date().toISOString(),
                authentication: {
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Unknown authentication error'
                }
            },
            { status: 503 }
        );
    }
} 