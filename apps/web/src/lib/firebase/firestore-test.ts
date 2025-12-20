import { db } from './config';
import {
    doc,
    getDoc,
    setDoc,
    collection,
    getDocs,
    connectFirestoreEmulator
} from 'firebase/firestore';
import { WebLogger } from '@/lib/web-logger';

/**
 * Test Firestore connection and basic operations
 */
export async function testFirestoreConnection(): Promise<{
    success: boolean;
    message: string;
    details?: any;
}> {
    try {
        // Test basic connection by trying to read from a test collection
        const testCollection = collection(db, 'connection-test');

        // Try to get documents (this will succeed even if collection is empty)
        const snapshot = await getDocs(testCollection);

        WebLogger.info('Firestore connection successful', { documentsInTestCollection: snapshot.size });

        return {
            success: true,
            message: 'Firestore connection successful',
            details: {
                projectId: db.app.options.projectId,
                documentsInTestCollection: snapshot.size
            }
        };
    } catch (error) {
        WebLogger.error('Firestore connection failed', { error: error instanceof Error ? error.message : String(error) });
        return {
            success: false,
            message: 'Firestore connection failed',
            details: error
        };
    }
}

/**
 * Test write operations
 */
export async function testFirestoreWrite(): Promise<{
    success: boolean;
    message: string;
    details?: any;
}> {
    try {
        const testDoc = doc(db, 'connection-test', 'test-document');
        const testData = {
            message: 'Hello from Robota!',
            timestamp: new Date(),
            version: '1.0.0'
        };

        await setDoc(testDoc, testData);

        WebLogger.info('Firestore write test successful');

        return {
            success: true,
            message: 'Firestore write operation successful',
            details: testData
        };
    } catch (error) {
        WebLogger.error('Firestore write test failed', { error: error instanceof Error ? error.message : String(error) });
        return {
            success: false,
            message: 'Firestore write operation failed',
            details: error
        };
    }
}

/**
 * Test read operations
 */
export async function testFirestoreRead(): Promise<{
    success: boolean;
    message: string;
    details?: any;
}> {
    try {
        const testDoc = doc(db, 'connection-test', 'test-document');
        const docSnap = await getDoc(testDoc);

        if (docSnap.exists()) {
            const data = docSnap.data();
            WebLogger.info('Firestore read test successful', { data });

            return {
                success: true,
                message: 'Firestore read operation successful',
                details: data
            };
        } else {
            return {
                success: false,
                message: 'Test document does not exist',
                details: null
            };
        }
    } catch (error) {
        WebLogger.error('Firestore read test failed', { error: error instanceof Error ? error.message : String(error) });
        return {
            success: false,
            message: 'Firestore read operation failed',
            details: error
        };
    }
}

/**
 * Run all Firestore tests
 */
export async function runAllFirestoreTests(): Promise<void> {
    WebLogger.info('Starting Firestore connection tests');

    // Test 1: Connection
    const connectionResult = await testFirestoreConnection();
    WebLogger.info('Connection Test', { message: connectionResult.message });

    if (!connectionResult.success) {
        WebLogger.warn('Connection failed, skipping other tests');
        return;
    }

    // Test 2: Write
    WebLogger.info('Testing write operations');
    const writeResult = await testFirestoreWrite();
    WebLogger.info('Write Test', { message: writeResult.message });

    // Test 3: Read
    WebLogger.info('Testing read operations');
    const readResult = await testFirestoreRead();
    WebLogger.info('Read Test', { message: readResult.message });

    // Summary
    WebLogger.info('Test Summary', {
        connection: connectionResult.success,
        write: writeResult.success,
        read: readResult.success
    });

    if (connectionResult.success && writeResult.success && readResult.success) {
        WebLogger.info('All tests passed. Firestore is ready to use.');
    } else {
        WebLogger.warn('Some tests failed. Check Firebase configuration and security rules.');
    }
} 