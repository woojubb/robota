import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    increment,
    runTransaction,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import {
    UserExtended,
    CreditTransaction,
    CreditTransactionType,
    UserCreditSummary,
    FREE_TIER_LIMITS,
    SubscriptionPlan,
    CreditTopUpRequest
} from '@/types/user-credit';

/**
 * Collections in Firestore
 */
const USERS_COLLECTION = 'users_extended';
const TRANSACTIONS_COLLECTION = 'credit_transactions';

/**
 * Create initial user extended record when user signs up
 */
export async function createUserExtendedRecord(
    uid: string,
    email: string,
    displayName: string,
    timezone: string = 'UTC',
    preferredLanguage: string = 'ko'
): Promise<UserExtended> {
    const userRef = doc(db, USERS_COLLECTION, uid);

    // Check if document already exists
    const existingDoc = await getDoc(userRef);
    if (existingDoc.exists()) {
        return getUserExtended(uid) as Promise<UserExtended>;
    }

    const now = new Date();

    const userExtended: UserExtended = {
        uid,
        email,
        displayName,
        credits: {
            available: FREE_TIER_LIMITS.initial_credits,
            total_purchased: 0,
            total_used: 0,
            last_updated: now
        },
        subscription: {
            plan: 'free',
            status: 'active',
            started_at: now,
            expires_at: null,
            auto_renew: false
        },
        usage_stats: {
            total_api_calls: 0,
            total_agents_created: 0,
            total_conversations: 0,
            last_activity: now
        },
        created_at: now,
        updated_at: now,
        is_verified: false,
        timezone,
        preferred_language: preferredLanguage
    };

    try {
        await setDoc(userRef, {
            ...userExtended,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            'credits.last_updated': serverTimestamp(),
            'subscription.started_at': serverTimestamp(),
            'usage_stats.last_activity': serverTimestamp()
        });

        // Create initial credit transaction for free credits
        await createCreditTransaction(
            uid,
            'bonus',
            FREE_TIER_LIMITS.initial_credits,
            FREE_TIER_LIMITS.initial_credits,
            'Welcome bonus credits'
        );

        return userExtended;
    } catch (error) {
        console.error('Error creating user extended record:', error);
        throw error;
    }
}

/**
 * Get user extended record
 */
export async function getUserExtended(uid: string): Promise<UserExtended | null> {
    try {
        const userRef = doc(db, USERS_COLLECTION, uid);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return null;
        }

        const data = userDoc.data();
        return {
            ...data,
            credits: {
                ...data.credits,
                last_updated: data.credits.last_updated?.toDate() || new Date()
            },
            subscription: {
                ...data.subscription,
                started_at: data.subscription.started_at?.toDate() || new Date(),
                expires_at: data.subscription.expires_at?.toDate() || null
            },
            usage_stats: {
                ...data.usage_stats,
                last_activity: data.usage_stats.last_activity?.toDate() || new Date()
            },
            created_at: data.created_at?.toDate() || new Date(),
            updated_at: data.updated_at?.toDate() || new Date()
        } as UserExtended;
    } catch (error) {
        console.error('Error getting user extended record:', error);
        return null;
    }
}

/**
 * Get user credit summary for UI display
 */
export async function getUserCreditSummary(uid: string): Promise<UserCreditSummary | null> {
    try {
        const userExtended = await getUserExtended(uid);
        if (!userExtended) return null;

        // Get recent usage (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentTransactionsQuery = query(
            collection(db, TRANSACTIONS_COLLECTION),
            where('user_uid', '==', uid),
            where('type', '==', 'usage'),
            where('created_at', '>=', Timestamp.fromDate(thirtyDaysAgo)),
            orderBy('created_at', 'desc')
        );

        const recentSnap = await getDocs(recentTransactionsQuery);
        const recentUsage = recentSnap.docs.reduce((total, doc) => {
            return total + Math.abs(doc.data().amount);
        }, 0);

        // Estimate days remaining based on recent usage
        const avgDailyUsage = recentUsage / 30;
        const estimatedDaysRemaining = avgDailyUsage > 0
            ? Math.floor(userExtended.credits.available / avgDailyUsage)
            : undefined;

        return {
            available_credits: userExtended.credits.available,
            subscription_plan: userExtended.subscription.plan,
            subscription_status: userExtended.subscription.status,
            next_billing_date: userExtended.subscription.expires_at || undefined,
            recent_usage: recentUsage,
            estimated_days_remaining: estimatedDaysRemaining
        };
    } catch (error) {
        console.error('Error getting user credit summary:', error);
        return null; // Return null instead of throwing to prevent error propagation
    }
}

/**
 * Create a credit transaction record
 */
async function createCreditTransaction(
    uid: string,
    type: CreditTransactionType,
    amount: number,
    balanceAfter: number,
    description: string,
    metadata?: CreditTransaction['metadata']
): Promise<string> {
    try {
        const transaction: Omit<CreditTransaction, 'id'> = {
            user_uid: uid,
            type,
            amount,
            balance_after: balanceAfter,
            description,
            metadata,
            created_at: new Date()
        };

        const transactionRef = await addDoc(collection(db, TRANSACTIONS_COLLECTION), {
            ...transaction,
            created_at: serverTimestamp()
        });

        return transactionRef.id;
    } catch (error) {
        console.error('Error creating credit transaction:', error);
        throw error;
    }
}

/**
 * Use credits for API calls
 */
export async function useCredits(
    uid: string,
    amount: number,
    description: string,
    metadata?: {
        api_endpoint?: string;
        request_id?: string;
        agent_id?: string;
    }
): Promise<{ success: boolean; remainingCredits: number; error?: string }> {
    try {
        return await runTransaction(db, async (transaction) => {
            const userRef = doc(db, USERS_COLLECTION, uid);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists()) {
                throw new Error('User not found');
            }

            const userData = userDoc.data();
            const currentCredits = userData.credits?.available || 0;

            if (currentCredits < amount) {
                return {
                    success: false,
                    remainingCredits: currentCredits,
                    error: 'Insufficient credits'
                };
            }

            const newBalance = currentCredits - amount;

            // Update user credits
            transaction.update(userRef, {
                'credits.available': newBalance,
                'credits.total_used': increment(amount),
                'credits.last_updated': serverTimestamp(),
                'usage_stats.total_api_calls': increment(1),
                'usage_stats.last_activity': serverTimestamp(),
                updated_at: serverTimestamp()
            });

            // Create transaction record
            await createCreditTransaction(
                uid,
                'usage',
                -amount, // Negative for usage
                newBalance,
                description,
                metadata
            );

            return {
                success: true,
                remainingCredits: newBalance
            };
        });
    } catch (error) {
        console.error('Error using credits:', error);
        return {
            success: false,
            remainingCredits: 0,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Add credits to user account
 */
export async function addCredits(
    uid: string,
    amount: number,
    type: CreditTransactionType = 'purchase',
    description: string,
    metadata?: CreditTransaction['metadata']
): Promise<{ success: boolean; newBalance: number; error?: string }> {
    try {
        return await runTransaction(db, async (transaction) => {
            const userRef = doc(db, USERS_COLLECTION, uid);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists()) {
                throw new Error('User not found');
            }

            const userData = userDoc.data();
            const currentCredits = userData.credits?.available || 0;
            const newBalance = currentCredits + amount;

            // Update user credits
            transaction.update(userRef, {
                'credits.available': newBalance,
                'credits.total_purchased': increment(amount),
                'credits.last_updated': serverTimestamp(),
                updated_at: serverTimestamp()
            });

            // Create transaction record
            await createCreditTransaction(
                uid,
                type,
                amount,
                newBalance,
                description,
                metadata
            );

            return {
                success: true,
                newBalance
            };
        });
    } catch (error) {
        console.error('Error adding credits:', error);
        return {
            success: false,
            newBalance: 0,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Get user's credit transaction history
 */
export async function getCreditTransactionHistory(
    uid: string,
    limitCount: number = 50
): Promise<CreditTransaction[]> {
    try {
        const transactionsQuery = query(
            collection(db, TRANSACTIONS_COLLECTION),
            where('user_uid', '==', uid),
            orderBy('created_at', 'desc'),
            limit(limitCount)
        );

        const snapshot = await getDocs(transactionsQuery);

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            created_at: doc.data().created_at?.toDate() || new Date()
        })) as CreditTransaction[];
    } catch (error) {
        console.error('Error getting transaction history:', error);
        return []; // Return empty array instead of throwing
    }
}

/**
 * Update user subscription plan
 */
export async function updateUserSubscription(
    uid: string,
    plan: SubscriptionPlan,
    expiresAt?: Date
): Promise<void> {
    try {
        const userRef = doc(db, USERS_COLLECTION, uid);

        await updateDoc(userRef, {
            'subscription.plan': plan,
            'subscription.status': 'active',
            'subscription.expires_at': expiresAt ? Timestamp.fromDate(expiresAt) : null,
            updated_at: serverTimestamp()
        });
    } catch (error) {
        console.error('Error updating user subscription:', error);
        throw error;
    }
}

/**
 * Check if user has sufficient credits
 */
export async function checkSufficientCredits(
    uid: string,
    requiredAmount: number
): Promise<{ sufficient: boolean; availableCredits: number }> {
    try {
        const userExtended = await getUserExtended(uid);

        if (!userExtended) {
            return { sufficient: false, availableCredits: 0 };
        }

        return {
            sufficient: userExtended.credits.available >= requiredAmount,
            availableCredits: userExtended.credits.available
        };
    } catch (error) {
        console.error('Error checking credits:', error);
        return { sufficient: false, availableCredits: 0 };
    }
} 