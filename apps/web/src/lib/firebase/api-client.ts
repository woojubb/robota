import { auth } from './config';

const FIRESTORE_API_BASE = `https://firestore.googleapis.com/v1/projects/${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}/databases/robota-io/documents`;

/**
 * Get Firebase Auth token for API calls
 */
async function getAuthToken(): Promise<string | null> {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        return await user.getIdToken();
    } catch (error) {
        console.error('Error getting auth token:', error);
        return null;
    }
}

/**
 * Make authenticated API request to Firestore REST API
 */
async function firestoreRequest(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
    body?: any
): Promise<any> {
    const token = await getAuthToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${FIRESTORE_API_BASE}${endpoint}`, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        throw new Error(`Firestore API error: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Get a document using REST API
 */
export async function getDocument(collection: string, documentId: string): Promise<any> {
    try {
        const data = await firestoreRequest(`/${collection}/${documentId}`);
        return parseFirestoreDocument(data);
    } catch (error) {
        console.error('Error getting document:', error);
        return null;
    }
}

/**
 * Parse Firestore REST API response to normal JS object
 */
function parseFirestoreDocument(doc: any): any {
    if (!doc.fields) return null;

    const result: any = {};

    for (const [key, value] of Object.entries(doc.fields)) {
        result[key] = parseFirestoreValue(value);
    }

    return result;
}

/**
 * Parse individual Firestore value
 */
function parseFirestoreValue(value: any): any {
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.integerValue !== undefined) return parseInt(value.integerValue);
    if (value.doubleValue !== undefined) return value.doubleValue;
    if (value.booleanValue !== undefined) return value.booleanValue;
    if (value.timestampValue !== undefined) return new Date(value.timestampValue);
    if (value.nullValue !== undefined) return null;
    if (value.mapValue !== undefined) {
        const result: any = {};
        for (const [k, v] of Object.entries(value.mapValue.fields || {})) {
            result[k] = parseFirestoreValue(v);
        }
        return result;
    }
    if (value.arrayValue !== undefined) {
        return (value.arrayValue.values || []).map(parseFirestoreValue);
    }
    return null;
} 