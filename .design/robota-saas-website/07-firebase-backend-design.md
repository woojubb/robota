# Firebase 백엔드 설계

## Firebase 서비스 구성

### 사용할 Firebase 서비스들
```
┌─────────────────────────────────────────────────────────┐
│                 Firebase Services                       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │    Auth     │  │  Firestore  │  │   Storage   │    │
│  │             │  │  Database   │  │             │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Functions  │  │   Hosting   │  │  Analytics  │    │
│  │  (API)      │  │             │  │             │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Performance │  │  App Check  │  │   Remote    │    │
│  │ Monitoring  │  │  Security   │  │   Config    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Firestore 데이터베이스 설계

### 컬렉션 구조
```
robota-saas/
├── users/                          # 사용자 프로필
│   ├── {userId}/
│   │   ├── profile: UserProfile
│   │   ├── subscription: SubscriptionInfo
│   │   ├── preferences: UserPreferences
│   │   └── metadata: UserMetadata
│   └── subcollections/
│       ├── apiKeys/                 # API 키들
│       ├── projects/               # 사용자 프로젝트들
│       ├── usage/                  # 사용량 기록
│       └── notifications/          # 알림들
├── templates/                      # Playground 템플릿
│   ├── {templateId}/
│   │   ├── definition: TemplateDefinition
│   │   ├── metadata: TemplateMetadata
│   │   └── content: TemplateContent
│   └── subcollections/
│       ├── versions/              # 템플릿 버전들
│       ├── examples/              # 사용 예제들
│       └── reviews/               # 사용자 리뷰들
├── playgroundProjects/            # Playground 프로젝트
│   ├── {projectId}/
│   │   ├── metadata: ProjectMetadata
│   │   ├── files: ProjectFile[]
│   │   └── settings: ProjectSettings
│   └── subcollections/
│       ├── versions/              # 프로젝트 버전들
│       ├── shares/                # 공유 정보
│       └── collaborators/         # 협업자들
├── analytics/                     # 분석 데이터
│   ├── daily/                     # 일별 집계
│   ├── monthly/                   # 월별 집계
│   └── events/                    # 이벤트 로그
├── billing/                       # 청구 관련
│   ├── invoices/                  # 청구서들
│   ├── payments/                  # 결제 기록
│   └── subscriptions/            # 구독 정보
└── system/                        # 시스템 설정
    ├── config/                    # 설정 정보
    ├── maintenance/               # 유지보수 정보
    └── announcements/             # 공지사항
```

### 주요 데이터 모델

#### 사용자 관련
```typescript
// users/{userId}/profile
interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  emailVerified: boolean;
  
  // 인증 정보
  providers: AuthProvider[];
  lastLoginAt: Timestamp;
  loginCount: number;
  
  // 계정 상태
  status: 'active' | 'suspended' | 'deleted';
  role: 'user' | 'admin' | 'moderator';
  
  // 타임스탬프
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// users/{userId}/subscription
interface SubscriptionInfo {
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  
  // 결제 정보
  customerId?: string; // Stripe customer ID
  subscriptionId?: string; // Stripe subscription ID
  
  // 기간 정보
  currentPeriodStart: Timestamp;
  currentPeriodEnd: Timestamp;
  trialEnd?: Timestamp;
  
  // 사용량 제한
  limits: {
    apiCallsPerMonth: number;
    apiKeysMax: number;
    projectsMax: number;
    storageGB: number;
  };
  
  // 현재 사용량
  usage: {
    apiCallsThisMonth: number;
    apiKeysCount: number;
    projectsCount: number;
    storageUsedGB: number;
    lastResetAt: Timestamp;
  };
}

// users/{userId}/preferences
interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: 'ko' | 'en';
  timezone: string;
  
  notifications: {
    email: {
      marketing: boolean;
      productUpdates: boolean;
      usageAlerts: boolean;
      billingAlerts: boolean;
    };
    browser: {
      enabled: boolean;
      quietHours: boolean;
    };
  };
  
  editor: {
    fontSize: number;
    tabSize: number;
    wordWrap: boolean;
    autoSave: boolean;
  };
}
```

#### API 키 관리
```typescript
// users/{userId}/apiKeys/{keyId}
interface ApiKey {
  id: string;
  name: string;
  keyHash: string; // bcrypt 해시
  keyType: 'test' | 'live';
  
  // 권한 및 스코프
  scopes: ApiScope[];
  permissions: ApiPermission[];
  
  // 보안 설정
  allowedOrigins: string[];
  allowedIPs: string[];
  rateLimit: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };
  
  // 상태
  status: 'active' | 'suspended' | 'revoked';
  lastUsedAt?: Timestamp;
  usageCount: number;
  
  // 만료
  expiresAt?: Timestamp;
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### 프로젝트 관리
```typescript
// playgroundProjects/{projectId}
interface PlaygroundProject {
  id: string;
  name: string;
  description?: string;
  
  // 소유권
  ownerId: string;
  ownerDisplayName: string;
  
  // 가시성
  visibility: 'private' | 'public' | 'unlisted';
  
  // 프로젝트 설정
  template?: string;
  language: 'typescript' | 'javascript';
  
  // 파일들
  files: {
    [path: string]: {
      content: string;
      language: string;
      size: number;
    };
  };
  
  // 실행 환경
  environment: {
    nodeVersion: string;
    dependencies: string[];
    timeout: number;
  };
  
  // 메타데이터
  tags: string[];
  category?: string;
  
  // 통계
  stats: {
    views: number;
    forks: number;
    stars: number;
    executions: number;
  };
  
  // 타임스탬프
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastExecutedAt?: Timestamp;
}
```

## Firebase Functions API 설계

### 함수 구조
```
functions/
├── src/
│   ├── auth/                    # 인증 관련 함수들
│   │   ├── onUserCreate.ts
│   │   ├── onUserDelete.ts
│   │   └── customClaims.ts
│   ├── api/                     # API 엔드포인트들
│   │   ├── robota/             # Robota SDK API
│   │   │   ├── chat.ts
│   │   │   ├── agents.ts
│   │   │   └── tools.ts
│   │   ├── playground/         # Playground API
│   │   │   ├── execute.ts
│   │   │   ├── templates.ts
│   │   │   └── projects.ts
│   │   └── billing/            # 결제 API
│   │       ├── stripe.ts
│   │       ├── invoices.ts
│   │       └── usage.ts
│   ├── triggers/               # 트리거 함수들
│   │   ├── onUsageUpdate.ts
│   │   ├── onBillingCycle.ts
│   │   └── onProjectShare.ts
│   ├── scheduled/              # 스케줄드 함수들
│   │   ├── dailyUsageReset.ts
│   │   ├── monthlyBilling.ts
│   │   └── cleanup.ts
│   └── utils/                  # 유틸리티들
│       ├── auth.ts
│       ├── validation.ts
│       └── errors.ts
└── package.json
```

### 주요 API 함수들

#### Robota SDK API
```typescript
// functions/src/api/robota/chat.ts
import { onRequest } from 'firebase-functions/v2/https';
import { validateApiKey, checkRateLimit } from '../utils/auth';
import { Robota } from '@robota/agents';

export const chatCompletions = onRequest(
  { 
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 60 
  },
  async (req, res) => {
    try {
      // API 키 검증
      const apiKey = req.headers.authorization?.replace('Bearer ', '');
      if (!apiKey) {
        return res.status(401).json({ error: 'Missing API key' });
      }

      const keyData = await validateApiKey(apiKey);
      if (!keyData) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Rate limiting 확인
      const rateLimitResult = await checkRateLimit(keyData.id);
      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: rateLimitResult.retryAfter,
        });
      }

      // 요청 검증
      const { model, messages, temperature, maxTokens, stream } = req.body;
      
      if (!model || !messages) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Robota 에이전트 생성
      const agent = new Robota({
        provider: getProviderFromModel(model),
        model,
        temperature: temperature || 0.7,
        maxTokens: maxTokens || 1000,
      });

      // 스트리밍 응답
      if (stream) {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const stream = agent.runStream(messages[messages.length - 1].content);
        
        for await (const chunk of stream) {
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
        
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        // 일반 응답
        const response = await agent.run(messages[messages.length - 1].content);
        
        res.json({
          id: `chatcmpl-${generateId()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: response,
            },
            finish_reason: 'stop',
          }],
        });
      }

      // 사용량 로깅
      await logUsage(keyData.userId, {
        endpoint: '/chat/completions',
        model,
        inputTokens: estimateTokens(messages),
        outputTokens: estimateTokens([{ content: response }]),
      });

    } catch (error) {
      console.error('Chat completion error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
```

#### Playground 실행 API
```typescript
// functions/src/api/playground/execute.ts
export const executeCode = onRequest(
  {
    cors: true,
    memory: '1GiB',
    timeoutSeconds: 30,
  },
  async (req, res) => {
    try {
      const { code, environment } = req.body;
      
      // 사용자 인증 확인
      const idToken = req.headers.authorization?.replace('Bearer ', '');
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      
      // 사용자 제한 확인
      const userProfile = await getUserProfile(decodedToken.uid);
      await checkExecutionLimits(userProfile);
      
      // 코드 실행 (Docker 컨테이너 사용)
      const executionResult = await runCodeInContainer({
        code,
        environment,
        timeout: 30000,
        memory: '256MB',
      });
      
      res.json(executionResult);
      
      // 실행 통계 업데이트
      await incrementExecutionCount(decodedToken.uid);
      
    } catch (error) {
      console.error('Code execution error:', error);
      res.status(500).json({ error: error.message });
    }
  }
);
```

### 트리거 함수들

#### 사용자 생성 트리거
```typescript
// functions/src/auth/onUserCreate.ts
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

export const onUserCreate = onDocumentCreated(
  'users/{userId}',
  async (event) => {
    const userData = event.data?.data();
    const userId = event.params.userId;
    
    try {
      // 기본 구독 플랜 설정
      await admin.firestore()
        .collection('users')
        .doc(userId)
        .collection('subscription')
        .doc('current')
        .set({
          plan: 'free',
          status: 'active',
          currentPeriodStart: admin.firestore.FieldValue.serverTimestamp(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          limits: FREE_PLAN_LIMITS,
          usage: {
            apiCallsThisMonth: 0,
            apiKeysCount: 0,
            projectsCount: 0,
            storageUsedGB: 0,
            lastResetAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
      
      // 기본 설정 생성
      await admin.firestore()
        .collection('users')
        .doc(userId)
        .collection('preferences')
        .doc('current')
        .set(DEFAULT_USER_PREFERENCES);
      
      // 환영 이메일 발송 (선택적)
      await sendWelcomeEmail(userData.email, userData.displayName);
      
    } catch (error) {
      console.error('Error setting up new user:', error);
    }
  }
);
```

#### 사용량 업데이트 트리거
```typescript
// functions/src/triggers/onUsageUpdate.ts
export const onUsageUpdate = onDocumentWritten(
  'usage/{userId}/daily/{date}',
  async (event) => {
    const usageData = event.data?.after.data();
    const userId = event.params.userId;
    
    try {
      // 사용자 구독 정보 가져오기
      const subscriptionDoc = await admin.firestore()
        .collection('users')
        .doc(userId)
        .collection('subscription')
        .doc('current')
        .get();
      
      const subscription = subscriptionDoc.data();
      if (!subscription) return;
      
      // 한도 초과 확인
      if (usageData.apiCalls > subscription.limits.apiCallsPerMonth) {
        // 사용량 초과 알림
        await sendUsageExceededNotification(userId, {
          current: usageData.apiCalls,
          limit: subscription.limits.apiCallsPerMonth,
        });
        
        // API 키 일시 정지 (선택적)
        if (subscription.plan === 'free') {
          await suspendApiKeys(userId);
        }
      }
      
      // 월별 집계 업데이트
      await updateMonthlyUsage(userId, usageData);
      
    } catch (error) {
      console.error('Error processing usage update:', error);
    }
  }
);
```

### 스케줄드 함수들

#### 일일 사용량 리셋
```typescript
// functions/src/scheduled/dailyUsageReset.ts
import { onSchedule } from 'firebase-functions/v2/scheduler';

export const dailyUsageReset = onSchedule(
  '0 0 * * *', // 매일 자정
  async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // 모든 사용자의 일일 사용량 초기화
      const usersSnapshot = await admin.firestore()
        .collection('users')
        .get();
      
      const batch = admin.firestore().batch();
      
      usersSnapshot.docs.forEach((userDoc) => {
        const dailyUsageRef = userDoc.ref
          .collection('usage')
          .doc(today);
        
        batch.set(dailyUsageRef, {
          apiCalls: 0,
          tokens: 0,
          executions: 0,
          errors: 0,
          lastResetAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      
      await batch.commit();
      console.log(`Daily usage reset completed for ${usersSnapshot.size} users`);
      
    } catch (error) {
      console.error('Error resetting daily usage:', error);
    }
  }
);
```

#### 월별 청구
```typescript
// functions/src/scheduled/monthlyBilling.ts
export const monthlyBilling = onSchedule(
  '0 2 1 * *', // 매월 1일 새벽 2시
  async () => {
    try {
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const monthKey = lastMonth.toISOString().slice(0, 7); // YYYY-MM
      
      // 유료 구독자들 조회
      const paidUsersSnapshot = await admin.firestore()
        .collectionGroup('subscription')
        .where('plan', '!=', 'free')
        .where('status', '==', 'active')
        .get();
      
      for (const subDoc of paidUsersSnapshot.docs) {
        const userId = subDoc.ref.parent.parent?.id;
        if (!userId) continue;
        
        try {
          // 월별 사용량 집계
          const monthlyUsage = await aggregateMonthlyUsage(userId, monthKey);
          
          // 청구서 생성
          const invoice = await generateInvoice(userId, monthlyUsage);
          
          // Stripe 결제 처리
          await processPayment(invoice);
          
        } catch (error) {
          console.error(`Error billing user ${userId}:`, error);
        }
      }
      
    } catch (error) {
      console.error('Error in monthly billing:', error);
    }
  }
);
```

## Security Rules

### Firestore Security Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 사용자는 자신의 데이터만 접근 가능
    match /users/{userId} {
      allow read, write: if request.auth != null 
        && request.auth.uid == userId;
      
      // 관리자는 모든 사용자 데이터 읽기 가능
      allow read: if request.auth != null 
        && request.auth.token.role == 'admin';
    }
    
    // 사용자 서브컬렉션들
    match /users/{userId}/{subcollection}/{docId} {
      allow read, write: if request.auth != null 
        && request.auth.uid == userId;
    }
    
    // 공개 템플릿은 모든 인증된 사용자가 읽기 가능
    match /templates/{templateId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null 
        && (request.auth.uid == resource.data.authorId 
            || request.auth.token.role in ['admin', 'moderator']);
    }
    
    // Playground 프로젝트 접근 규칙
    match /playgroundProjects/{projectId} {
      // 소유자는 모든 권한
      allow read, write: if request.auth != null 
        && request.auth.uid == resource.data.ownerId;
      
      // 공개 프로젝트는 읽기 가능
      allow read: if request.auth != null 
        && resource.data.visibility == 'public';
      
      // 공유된 프로젝트 읽기 (shareId가 있는 경우)
      allow read: if request.auth != null 
        && resource.data.shareId != null;
    }
    
    // 분석 데이터는 소유자와 관리자만 접근
    match /analytics/{userId}/{subcollection}/{docId} {
      allow read: if request.auth != null 
        && (request.auth.uid == userId 
            || request.auth.token.role == 'admin');
      allow write: if false; // 함수에서만 쓰기
    }
    
    // 시스템 컬렉션은 관리자만 접근
    match /system/{document=**} {
      allow read, write: if request.auth != null 
        && request.auth.token.role == 'admin';
    }
  }
}
```

### Storage Security Rules
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // 사용자 프로필 이미지
    match /profiles/{userId}/{fileName} {
      allow read, write: if request.auth != null 
        && request.auth.uid == userId
        && fileName.matches('.*\\.(jpg|jpeg|png|gif)$')
        && request.resource.size < 5 * 1024 * 1024; // 5MB 제한
    }
    
    // 프로젝트 파일들
    match /projects/{projectId}/{fileName} {
      allow read, write: if request.auth != null;
      // TODO: 프로젝트 소유권 확인 로직 추가
    }
    
    // 템플릿 관련 파일들
    match /templates/{templateId}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null 
        && request.auth.token.role in ['admin', 'moderator'];
    }
  }
}
```

## 성능 최적화

### 인덱스 설정
```json
{
  "indexes": [
    {
      "collectionGroup": "apiKeys",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "playgroundProjects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "visibility", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "usage",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "DESCENDING" }
      ]
    }
  ]
}
```

### 캐싱 전략
```typescript
// Redis 캐싱 전략
class CacheManager {
  private redis: Redis;
  
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    // 캐시에서 먼저 확인
    const cached = await this.redis.get(`user:${userId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Firestore에서 조회
    const doc = await admin.firestore()
      .collection('users')
      .doc(userId)
      .get();
    
    if (doc.exists) {
      const data = doc.data() as UserProfile;
      
      // 캐시에 저장 (5분)
      await this.redis.setex(`user:${userId}`, 300, JSON.stringify(data));
      
      return data;
    }
    
    return null;
  }
  
  async invalidateUserCache(userId: string): Promise<void> {
    await this.redis.del(`user:${userId}`);
  }
}
``` 