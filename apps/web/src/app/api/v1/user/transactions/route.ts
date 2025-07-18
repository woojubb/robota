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
    try {
        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const pageLimit = Math.min(parseInt(searchParams.get('limit') || '20'), 100); // Max 100 items

        // Check cache first
        const cacheKey = cacheKeys.userTransactions(uid, page, pageLimit);
        const cachedTransactions = apiCache.get(cacheKey);
        if (cachedTransactions) {
            return createSuccessResponse(cachedTransactions);
        }

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

        const transactions: CreditTransaction[] = querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                user_uid: data.user_uid,
                type: data.type,
                amount: data.amount,
                balance_after: data.balance_after,
                description: data.description,
                metadata: data.metadata || {},
                created_at: data.created_at?.toDate() || new Date(),
            };
        });

        // Get total count for pagination info
        const totalQuery = query(
            collection(db, 'credit_transactions'),
            where('user_uid', '==', uid)
        );
        const totalSnapshot = await getDocs(totalQuery);
        const totalCount = totalSnapshot.size;
        const totalPages = Math.ceil(totalCount / pageLimit);

        const result = {
            transactions,
            pagination: {
                page,
                limit: pageLimit,
                totalCount,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
            }
        };

        // Cache for 1 minute (recent transactions may change)
        apiCache.set(cacheKey, result, 1 * 60 * 1000);

        return createSuccessResponse(result);
    } catch (error) {
        console.error('Error fetching user transactions:', error);
        return createErrorResponse('Failed to fetch transaction history', 500);
    }
}); 