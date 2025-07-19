import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        const healthCheck = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: process.env.NEXT_PUBLIC_APP_ENV || 'development',
            version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
            uptime: process.uptime(),
            memory: {
                used: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100,
                total: Math.round((process.memoryUsage().heapTotal / 1024 / 1024) * 100) / 100,
            },
            nodeVersion: process.version,
        };

        return NextResponse.json(healthCheck, {
            status: 200,
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            },
        });
    } catch (error) {
        console.error('Health check failed:', error);

        return NextResponse.json(
            {
                status: 'error',
                timestamp: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
} 