import { NextRequest, NextResponse } from 'next/server';

/**
 * Health check endpoint
 * GET /api/v1/health
 */
export async function GET(request: NextRequest) {
    return NextResponse.json({
        success: true,
        data: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '0.1.0',
            environment: process.env.NODE_ENV || 'development',
        },
        message: 'Service is healthy',
    });
} 