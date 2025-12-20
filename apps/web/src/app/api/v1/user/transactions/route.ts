import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse, createErrorResponse } from '@/lib/auth-middleware';
import { db } from '@/lib/firebase/config';
import { collection, query, where, orderBy, limit, startAfter, getDocs, doc, getDoc } from 'firebase/firestore';
import { CreditTransaction } from '@/types/user-credit';
import { apiCache, cacheKeys } from '@/lib/cache';
import { WebLogger } from '@/lib/web-logger';

/**
 * Get user transaction history
 * GET /api/v1/user/transactions?page=1&limit=20
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    WebLogger.debug('Transactions API GET: start', { uid });

    try {
        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const pageLimit = Math.min(parseInt(searchParams.get('limit') || '20'), 100); // Max 100 items

        WebLogger.debug('Transactions API: pagination', { uid, page, pageLimit });

        // Check cache first
        WebLogger.debug('Transactions API: checking cache', { uid, page, pageLimit });
        const cacheKey = cacheKeys.userTransactions(uid, page, pageLimit);
        const cachedTransactions = apiCache.get(cacheKey);
        if (cachedTransactions) {
            WebLogger.debug('Transactions API: cache hit', { uid, page, pageLimit });
            return createSuccessResponse(cachedTransactions);
        }
        WebLogger.debug('Transactions API: cache miss, fetching from Firestore', { uid, page, pageLimit });

        let transactions = [];
        let hasMore = false;

        try {
            WebLogger.debug('Transactions API: fetching transactions from Firestore', { uid, page, pageLimit });

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

            WebLogger.debug('Transactions API: fetched transactions', { uid, count: transactions.length, hasMore });

        } catch (firestoreError) {
            WebLogger.error('Transactions API: Firestore connection error', { uid, error: firestoreError instanceof Error ? firestoreError.message : String(firestoreError) });
            WebLogger.warn('Transactions API: returning default transactions due to Firestore connectivity issue', { uid, page, pageLimit });

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

        WebLogger.debug('Transactions API: transactions processed successfully', { uid, page, pageLimit, count: transactions.length, hasMore });

        // Cache for 1 minute (short TTL for transaction data)
        apiCache.set(cacheKey, result, 1 * 60 * 1000);

        return createSuccessResponse(result);
    } catch (error) {
        WebLogger.error('Transactions API: error occurred', { uid, error: error instanceof Error ? error.message : String(error) });

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

        WebLogger.warn('Transactions API: returning fallback transactions due to error', { uid });
        return createSuccessResponse(fallbackResult, 'Fallback transactions returned due to error');
    }
}); 