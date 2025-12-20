import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/config';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { WebLogger } from '@/lib/web-logger';

/**
 * Test Firestore connectivity
 * GET /api/v1/test-firestore
 */
export async function GET(request: NextRequest) {
    try {
        WebLogger.debug('Testing Firestore connection');

        // Test 1: Simple collection access
        WebLogger.debug('Test 1: Accessing users collection');
        const usersRef = collection(db, 'users');
        WebLogger.debug('Users collection reference created');

        // Test 2: Try to get a specific document (without fetching all docs)
        WebLogger.debug('Test 2: Attempting to get a test document');
        const testDocRef = doc(db, 'test', 'connection');

        // This should fail gracefully if the document doesn't exist
        const testDoc = await getDoc(testDocRef);
        WebLogger.debug('Test document fetch completed', { exists: testDoc.exists() });

        return NextResponse.json({
            success: true,
            message: 'Firestore connection successful',
            tests: {
                collectionRef: 'OK',
                documentFetch: testDoc.exists() ? 'Document exists' : 'Document does not exist (normal)',
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        WebLogger.error('Firestore test error', { error: error instanceof Error ? error.message : String(error) });

        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            code: error instanceof Error && 'code' in error ? (error as any).code : 'UNKNOWN',
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
} 