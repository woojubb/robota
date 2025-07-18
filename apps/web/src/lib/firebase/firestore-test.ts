import { db } from './config';
import {
    doc,
    getDoc,
    setDoc,
    collection,
    getDocs,
    connectFirestoreEmulator
} from 'firebase/firestore';

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

        console.log('✅ Firestore connection successful!');
        console.log(`📊 Test collection contains ${snapshot.size} documents`);

        return {
            success: true,
            message: 'Firestore connection successful',
            details: {
                projectId: db.app.options.projectId,
                documentsInTestCollection: snapshot.size
            }
        };
    } catch (error) {
        console.error('❌ Firestore connection failed:', error);
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

        console.log('✅ Firestore write test successful!');

        return {
            success: true,
            message: 'Firestore write operation successful',
            details: testData
        };
    } catch (error) {
        console.error('❌ Firestore write test failed:', error);
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
            console.log('✅ Firestore read test successful!');
            console.log('📄 Document data:', data);

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
        console.error('❌ Firestore read test failed:', error);
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
    console.log('🔥 Starting Firestore connection tests...\n');

    // Test 1: Connection
    const connectionResult = await testFirestoreConnection();
    console.log('1️⃣ Connection Test:', connectionResult.message);

    if (!connectionResult.success) {
        console.log('❌ Connection failed, skipping other tests');
        return;
    }

    // Test 2: Write
    console.log('\n2️⃣ Testing write operations...');
    const writeResult = await testFirestoreWrite();
    console.log('Write Test:', writeResult.message);

    // Test 3: Read
    console.log('\n3️⃣ Testing read operations...');
    const readResult = await testFirestoreRead();
    console.log('Read Test:', readResult.message);

    // Summary
    console.log('\n📋 Test Summary:');
    console.log(`Connection: ${connectionResult.success ? '✅' : '❌'}`);
    console.log(`Write: ${writeResult.success ? '✅' : '❌'}`);
    console.log(`Read: ${readResult.success ? '✅' : '❌'}`);

    if (connectionResult.success && writeResult.success && readResult.success) {
        console.log('\n🎉 All tests passed! Firestore is ready to use.');
    } else {
        console.log('\n⚠️  Some tests failed. Check Firebase configuration and security rules.');
    }
} 