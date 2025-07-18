import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase/config';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';

/**
 * Test Firestore connectivity
 * GET /api/v1/test-firestore
 */
export async function GET(request: NextRequest) {
    try {
        console.log('Testing Firestore connection...');

        // Test 1: Simple collection access
        console.log('Test 1: Accessing users collection...');
        const usersRef = collection(db, 'users');
        console.log('Users collection reference created');

        // Test 2: Try to get a specific document (without fetching all docs)
        console.log('Test 2: Attempting to get a test document...');
        const testDocRef = doc(db, 'test', 'connection');

        // This should fail gracefully if the document doesn't exist
        const testDoc = await getDoc(testDocRef);
        console.log('Test document fetch completed, exists:', testDoc.exists());

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
        console.error('Firestore test error:', error);

        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            code: error instanceof Error && 'code' in error ? (error as any).code : 'UNKNOWN',
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
} 