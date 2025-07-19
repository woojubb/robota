import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/config';
import { doc, getDoc } from 'firebase/firestore';

export async function GET(request: NextRequest) {
    try {
        // Test Firestore connectivity by creating a test document read
        const startTime = Date.now();

        // Try to read a system document or create a health check document
        const healthDocRef = doc(db, 'system', 'health');
        await getDoc(healthDocRef);

        const responseTime = Date.now() - startTime;

        const healthCheck = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            database: {
                status: 'connected',
                responseTime: `${responseTime}ms`,
                type: 'firestore',
            },
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
        console.error('Database health check failed:', error);

        return NextResponse.json(
            {
                status: 'error',
                timestamp: new Date().toISOString(),
                database: {
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Unknown database error'
                }
            },
            { status: 503 }
        );
    }
} 