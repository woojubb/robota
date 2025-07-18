import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse, createErrorResponse } from '@/lib/auth-middleware';
import { db } from '@/lib/firebase/config';
import { collection, query, where, orderBy, limit, startAfter, getDocs, doc, getDoc } from 'firebase/firestore';
import { CreditTransaction } from '@/types/user-credit';
import { apiCache, cacheKeys } from '@/lib/cache';

/**
 * Get user transaction history
 * GET /api/v1/user/transactions?page=1&limit=20
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    console.log('Transactions API GET: Starting for user:', uid);

    try {
        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const pageLimit = Math.min(parseInt(searchParams.get('limit') || '20'), 100); // Max 100 items

        console.log('Transactions API: Page:', page, 'Limit:', pageLimit);

        // Check cache first
        console.log('Transactions API: Checking cache...');
        const cacheKey = cacheKeys.userTransactions(uid, page, pageLimit);
        const cachedTransactions = apiCache.get(cacheKey);
        if (cachedTransactions) {
            console.log('Transactions API: Cache hit, returning cached data');
            return createSuccessResponse(cachedTransactions);
        }
        console.log('Transactions API: Cache miss, fetching from Firestore');

        let transactions = [];
        let hasMore = false;

        try {
            console.log('Transactions API: Fetching transactions from Firestore...');

            // Build query
            let transactionsQuery = query(
                collection(db, 'credit_transactions'),
                where('user_uid', '==', uid),
                orderBy('created_at', 'desc'),
                limit(pageLimit)
            );

            // Handle pagination
            if (page > 1) {
                // Get the last document from previous page
                const offset = (page - 1) * pageLimit;
                const prevPageQuery = query(
                    collection(db, 'credit_transactions'),
                    where('user_uid', '==', uid),
                    orderBy('created_at', 'desc'),
                    limit(offset)
                );

                const prevPageDocs = await getDocs(prevPageQuery);
                if (prevPageDocs.docs.length > 0) {
                    const lastDoc = prevPageDocs.docs[prevPageDocs.docs.length - 1];
                    transactionsQuery = query(
                        collection(db, 'credit_transactions'),
                        where('user_uid', '==', uid),
                        orderBy('created_at', 'desc'),
                        startAfter(lastDoc),
                        limit(pageLimit)
                    );
                }
            }

            const querySnapshot = await getDocs(transactionsQuery);

            transactions = querySnapshot.docs.map(docSnapshot => ({
                id: docSnapshot.id,
                ...docSnapshot.data(),
                created_at: docSnapshot.data().created_at?.toDate?.() || new Date(docSnapshot.data().created_at),
                updated_at: docSnapshot.data().updated_at?.toDate?.() || new Date(docSnapshot.data().updated_at),
            }));

            // Check if there are more transactions
            hasMore = querySnapshot.docs.length === pageLimit;

            console.log('Transactions API: Fetched', transactions.length, 'transactions');

        } catch (firestoreError) {
            console.error('Transactions API: Firestore connection error:', firestoreError);
            console.log('Transactions API: Returning default transactions due to Firestore connection issue');

            // Return default empty transactions when Firestore is unavailable
            const defaultResult = {
                transactions: [],
                pagination: {
                    page,
                    limit: pageLimit,
                    hasMore: false,
                    total: 0
                }
            };

            // Cache the default result for a shorter time
            apiCache.set(cacheKey, defaultResult, 30 * 1000); // 30 seconds

            return createSuccessResponse(defaultResult, 'Default transactions returned due to database connectivity issue');
        }

        const result = {
            transactions,
            pagination: {
                page,
                limit: pageLimit,
                hasMore,
                total: transactions.length + (page - 1) * pageLimit // Approximate total
            }
        };

        console.log('Transactions API: Transactions processed successfully');

        // Cache for 1 minute (short TTL for transaction data)
        apiCache.set(cacheKey, result, 1 * 60 * 1000);

        return createSuccessResponse(result);
    } catch (error) {
        console.error('Transactions API: Error occurred:', error);
        console.error('Transactions API: Error stack:', error instanceof Error ? error.stack : 'No stack trace');

        // Return default empty transactions as last resort
        const fallbackResult = {
            transactions: [],
            pagination: {
                page: parseInt(new URL(request.url).searchParams.get('page') || '1'),
                limit: parseInt(new URL(request.url).searchParams.get('limit') || '20'),
                hasMore: false,
                total: 0
            }
        };

        console.log('Transactions API: Returning fallback transactions due to error');
        return createSuccessResponse(fallbackResult, 'Fallback transactions returned due to error');
    }
}); 