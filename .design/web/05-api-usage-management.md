# API 및 사용량 관리 시스템

## API 서비스 아키텍처

### API Gateway 구조
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client        │    │   Firebase      │    │   Robota SDK    │
│   Application   │◄──►│   Functions     │◄──►│   Services      │
│                 │    │   (API Gateway) │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Keys      │    │   Rate Limiter  │    │   External      │
│   & Auth        │    │   & Usage Track │    │   AI Providers  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## API Key 관리 시스템

### API Key 구조
```typescript
interface ApiKey {
  id: string;
  userId: string;
  name: string;
  key: string; // sk_live_... 또는 sk_test_...
  keyType: 'test' | 'live';
  
  // 권한 설정
  permissions: ApiPermission[];
  scopes: ApiScope[];
  
  // 보안 설정
  allowedOrigins?: string[]; // CORS 허용 도메인
  allowedIPs?: string[]; // IP 화이트리스트
  rateLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };
  
  // 상태 정보
  status: 'active' | 'suspended' | 'revoked';
  createdAt: Timestamp;
  lastUsedAt?: Timestamp;
  expiresAt?: Timestamp;
  
  // 사용량 정보
  usage: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalTokens: number;
    lastResetAt: Timestamp;
  };
}

enum ApiScope {
  // 기본 AI 기능
  CHAT_COMPLETION = 'chat:completion',
  CHAT_STREAMING = 'chat:streaming',
  
  // 에이전트 관리
  AGENT_CREATE = 'agent:create',
  AGENT_READ = 'agent:read',
  AGENT_UPDATE = 'agent:update',
  AGENT_DELETE = 'agent:delete',
  
  // 템플릿 접근
  TEMPLATE_READ = 'template:read',
  TEMPLATE_CUSTOM = 'template:custom',
  
  // 팀 기능
  TEAM_COLLABORATE = 'team:collaborate',
  TEAM_MANAGE = 'team:manage',
  
  // 분석 및 모니터링
  ANALYTICS_READ = 'analytics:read',
  USAGE_STATS = 'usage:stats',
}

enum ApiPermission {
  READ_ONLY = 'read_only',
  READ_WRITE = 'read_write',
  ADMIN = 'admin',
}
```

### API Key 생성 및 관리
```typescript
// API Key 생성
async function createApiKey(
  userId: string, 
  keyData: CreateApiKeyRequest
): Promise<ApiKey> {
  // 사용자 구독 플랜 확인
  const userProfile = await getUserProfile(userId);
  const plan = userProfile.subscription.plan;
  
  // 플랜별 키 생성 제한 확인
  const existingKeys = await getApiKeysByUser(userId);
  const planLimits = getApiKeyLimitsByPlan(plan);
  
  if (existingKeys.length >= planLimits.maxKeys) {
    throw new Error(`${plan} 플랜에서는 최대 ${planLimits.maxKeys}개의 API 키만 생성할 수 있습니다.`);
  }
  
  // 키 생성
  const keyPrefix = keyData.keyType === 'live' ? 'sk_live_' : 'sk_test_';
  const randomKey = generateSecureKey(32);
  const apiKey = `${keyPrefix}${randomKey}`;
  
  // 키 해시화 및 저장
  const hashedKey = await hashApiKey(apiKey);
  
  const newKey: ApiKey = {
    id: generateId(),
    userId,
    name: keyData.name,
    key: hashedKey,
    keyType: keyData.keyType,
    permissions: keyData.permissions || [ApiPermission.READ_WRITE],
    scopes: keyData.scopes || getDefaultScopesByPlan(plan),
    allowedOrigins: keyData.allowedOrigins,
    allowedIPs: keyData.allowedIPs,
    rateLimits: getRateLimitsByPlan(plan),
    status: 'active',
    createdAt: serverTimestamp(),
    usage: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      lastResetAt: serverTimestamp(),
    },
  };
  
  await setDoc(doc(db, 'apiKeys', newKey.id), newKey);
  
  // 평문 키는 한 번만 반환
  return { ...newKey, key: apiKey };
}
```

## Rate Limiting 시스템

### 다단계 Rate Limiting
```typescript
interface RateLimit {
  windowSize: number; // 시간 윈도우 (초)
  maxRequests: number; // 최대 요청 수
  burstLimit?: number; // 버스트 허용량
}

class ApiRateLimiter {
  private redis: Redis; // Redis 클라이언트
  
  async checkRateLimit(
    keyId: string, 
    limits: RateLimit[]
  ): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    
    for (const limit of limits) {
      const windowStart = Math.floor(now / limit.windowSize) * limit.windowSize;
      const key = `rate_limit:${keyId}:${limit.windowSize}:${windowStart}`;
      
      const current = await this.redis.incr(key);
      
      if (current === 1) {
        await this.redis.expire(key, limit.windowSize);
      }
      
      if (current > limit.maxRequests) {
        const resetTime = windowStart + limit.windowSize;
        return {
          allowed: false,
          limit: limit.maxRequests,
          remaining: 0,
          resetTime,
          retryAfter: resetTime - now,
        };
      }
    }
    
    return {
      allowed: true,
      limit: limits[0].maxRequests,
      remaining: limits[0].maxRequests - (await this.getCurrentUsage(keyId, limits[0])),
      resetTime: Math.floor(now / limits[0].windowSize) * limits[0].windowSize + limits[0].windowSize,
    };
  }
}
```

### 플랜별 Rate Limit 설정
```typescript
const PLAN_RATE_LIMITS = {
  free: {
    requestsPerMinute: 20,
    requestsPerHour: 1000,
    requestsPerDay: 10000,
    tokensPerMinute: 150000,
    tokensPerDay: 1000000,
  },
  starter: {
    requestsPerMinute: 60,
    requestsPerHour: 3600,
    requestsPerDay: 50000,
    tokensPerMinute: 500000,
    tokensPerDay: 10000000,
  },
  pro: {
    requestsPerMinute: 300,
    requestsPerHour: 18000,
    requestsPerDay: 200000,
    tokensPerMinute: 2000000,
    tokensPerDay: 50000000,
  },
  enterprise: {
    // 커스텀 설정
    requestsPerMinute: 1000,
    requestsPerHour: 60000,
    requestsPerDay: 1000000,
    tokensPerMinute: 10000000,
    tokensPerDay: 200000000,
  },
};
```

## 사용량 추적 및 분석

### 사용량 데이터 수집
```typescript
interface UsageEvent {
  id: string;
  userId: string;
  apiKeyId: string;
  
  // 요청 정보
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  timestamp: Timestamp;
  
  // 응답 정보
  statusCode: number;
  responseTime: number; // 밀리초
  
  // AI 관련 메트릭
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  
  // 비용 정보
  cost?: number; // USD
  
  // 에러 정보
  errorCode?: string;
  errorMessage?: string;
  
  // 요청 메타데이터
  userAgent?: string;
  ipAddress?: string;
  origin?: string;
}

// 사용량 이벤트 로깅
async function logUsageEvent(event: UsageEvent): Promise<void> {
  // Firestore에 실시간 로깅
  await addDoc(collection(db, 'usageEvents'), event);
  
  // Redis에 집계 데이터 업데이트
  await updateUsageAggregates(event);
  
  // 사용량 제한 체크
  await checkUsageLimits(event.userId, event.apiKeyId);
}

// 사용량 집계 업데이트
async function updateUsageAggregates(event: UsageEvent): Promise<void> {
  const redis = getRedisClient();
  const now = new Date();
  
  // 분별 집계
  const minuteKey = `usage:minute:${event.userId}:${formatMinute(now)}`;
  await redis.hincrby(minuteKey, 'requests', 1);
  await redis.hincrby(minuteKey, 'tokens', event.totalTokens || 0);
  await redis.expire(minuteKey, 3600); // 1시간 후 만료
  
  // 시간별 집계
  const hourKey = `usage:hour:${event.userId}:${formatHour(now)}`;
  await redis.hincrby(hourKey, 'requests', 1);
  await redis.hincrby(hourKey, 'tokens', event.totalTokens || 0);
  await redis.expire(hourKey, 86400); // 24시간 후 만료
  
  // 일별 집계
  const dayKey = `usage:day:${event.userId}:${formatDay(now)}`;
  await redis.hincrby(dayKey, 'requests', 1);
  await redis.hincrby(dayKey, 'tokens', event.totalTokens || 0);
  await redis.expire(dayKey, 2592000); // 30일 후 만료
}
```

### 실시간 사용량 모니터링
```typescript
// 사용량 대시보드 데이터
interface UsageDashboard {
  current: {
    requestsToday: number;
    tokensToday: number;
    costToday: number;
    errorsToday: number;
  };
  
  trends: {
    requestsTrend: TrendData[];
    tokensTrend: TrendData[];
    costTrend: TrendData[];
    errorRateTrend: TrendData[];
  };
  
  limits: {
    dailyRequestLimit: number;
    dailyTokenLimit: number;
    monthlyBudget: number;
    currentUsagePercentage: number;
  };
  
  topEndpoints: EndpointUsage[];
  recentErrors: ErrorSummary[];
}

// 실시간 사용량 조회
async function getUserUsageDashboard(userId: string): Promise<UsageDashboard> {
  const redis = getRedisClient();
  const today = formatDay(new Date());
  
  // 오늘 사용량 조회
  const todayUsage = await redis.hmget(`usage:day:${userId}:${today}`, 
    'requests', 'tokens', 'cost', 'errors'
  );
  
  // 트렌드 데이터 조회 (지난 30일)
  const trendData = await getUsageTrends(userId, 30);
  
  // 사용자 제한 조회
  const userProfile = await getUserProfile(userId);
  const limits = PLAN_RATE_LIMITS[userProfile.subscription.plan];
  
  return {
    current: {
      requestsToday: parseInt(todayUsage[0] || '0'),
      tokensToday: parseInt(todayUsage[1] || '0'),
      costToday: parseFloat(todayUsage[2] || '0'),
      errorsToday: parseInt(todayUsage[3] || '0'),
    },
    trends: trendData,
    limits: {
      dailyRequestLimit: limits.requestsPerDay,
      dailyTokenLimit: limits.tokensPerDay,
      monthlyBudget: getBudgetByPlan(userProfile.subscription.plan),
      currentUsagePercentage: calculateUsagePercentage(todayUsage, limits),
    },
    topEndpoints: await getTopEndpoints(userId),
    recentErrors: await getRecentErrors(userId),
  };
}
```

## 요금 계산 시스템

### 토큰 기반 과금
```typescript
interface PricingModel {
  plan: SubscriptionPlan;
  tokenPricing: {
    inputTokenPrice: number; // USD per 1K tokens
    outputTokenPrice: number; // USD per 1K tokens
  };
  apiCallPricing: {
    pricePerCall: number; // USD per call
    includedCalls: number; // 플랜에 포함된 호출 수
  };
  overagePricing: {
    enabled: boolean;
    inputTokenOverage: number;
    outputTokenOverage: number;
    callOverage: number;
  };
}

const PRICING_MODELS: Record<SubscriptionPlan, PricingModel> = {
  free: {
    plan: 'free',
    tokenPricing: { inputTokenPrice: 0, outputTokenPrice: 0 },
    apiCallPricing: { pricePerCall: 0, includedCalls: 1000 },
    overagePricing: { enabled: false, inputTokenOverage: 0, outputTokenOverage: 0, callOverage: 0 },
  },
  starter: {
    plan: 'starter',
    tokenPricing: { inputTokenPrice: 0.0015, outputTokenPrice: 0.002 },
    apiCallPricing: { pricePerCall: 0.01, includedCalls: 10000 },
    overagePricing: { enabled: true, inputTokenOverage: 0.002, outputTokenOverage: 0.003, callOverage: 0.015 },
  },
  pro: {
    plan: 'pro',
    tokenPricing: { inputTokenPrice: 0.001, outputTokenPrice: 0.0015 },
    apiCallPricing: { pricePerCall: 0.008, includedCalls: 100000 },
    overagePricing: { enabled: true, inputTokenOverage: 0.0015, outputTokenOverage: 0.002, callOverage: 0.012 },
  },
  enterprise: {
    plan: 'enterprise',
    tokenPricing: { inputTokenPrice: 0.0008, outputTokenPrice: 0.0012 },
    apiCallPricing: { pricePerCall: 0.005, includedCalls: 1000000 },
    overagePricing: { enabled: true, inputTokenOverage: 0.001, outputTokenOverage: 0.0015, callOverage: 0.008 },
  },
};

// 비용 계산
function calculateUsageCost(
  usage: UsageEvent, 
  pricingModel: PricingModel
): number {
  let cost = 0;
  
  // 토큰 기반 비용
  if (usage.inputTokens && usage.outputTokens) {
    cost += (usage.inputTokens / 1000) * pricingModel.tokenPricing.inputTokenPrice;
    cost += (usage.outputTokens / 1000) * pricingModel.tokenPricing.outputTokenPrice;
  }
  
  // API 호출 비용
  cost += pricingModel.apiCallPricing.pricePerCall;
  
  return cost;
}
```

### 청구 및 결제 시스템
```typescript
interface BillingCycle {
  userId: string;
  billingPeriodStart: Timestamp;
  billingPeriodEnd: Timestamp;
  
  usage: {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  };
  
  charges: {
    subscriptionFee: number;
    usageFee: number;
    overageFee: number;
    totalAmount: number;
  };
  
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  paymentMethod?: string;
  invoiceUrl?: string;
  paidAt?: Timestamp;
}

// 월별 청구서 생성
async function generateMonthlyInvoice(userId: string, month: string): Promise<BillingCycle> {
  const startDate = new Date(`${month}-01`);
  const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
  
  // 해당 월의 사용량 집계
  const monthlyUsage = await aggregateMonthlyUsage(userId, startDate, endDate);
  
  // 요금 계산
  const userProfile = await getUserProfile(userId);
  const pricingModel = PRICING_MODELS[userProfile.subscription.plan];
  
  const subscriptionFee = getSubscriptionFee(userProfile.subscription.plan);
  const usageFee = calculateUsageFee(monthlyUsage, pricingModel);
  const overageFee = calculateOverageFee(monthlyUsage, pricingModel);
  
  const invoice: BillingCycle = {
    userId,
    billingPeriodStart: Timestamp.fromDate(startDate),
    billingPeriodEnd: Timestamp.fromDate(endDate),
    usage: monthlyUsage,
    charges: {
      subscriptionFee,
      usageFee,
      overageFee,
      totalAmount: subscriptionFee + usageFee + overageFee,
    },
    status: 'pending',
  };
  
  await setDoc(doc(db, 'billingCycles', generateInvoiceId(userId, month)), invoice);
  return invoice;
}
```

## API 문서 및 SDK 생성

### OpenAPI 스펙 자동 생성
```typescript
// OpenAPI 스펙 정의
const apiSpec: OpenAPIObject = {
  openapi: '3.0.0',
  info: {
    title: 'Robota API',
    version: '1.0.0',
    description: 'Multi-provider AI agent development API',
  },
  servers: [
    {
      url: 'https://api.robota.dev/v1',
      description: 'Production server',
    },
    {
      url: 'https://api-staging.robota.dev/v1',
      description: 'Staging server',
    },
  ],
  security: [
    {
      ApiKeyAuth: [],
    },
  ],
  paths: {
    '/chat/completions': {
      post: {
        summary: 'Create chat completion',
        operationId: 'createChatCompletion',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChatCompletionRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Chat completion response',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatCompletionResponse' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description: 'API key prefixed with "Bearer "',
      },
    },
    schemas: {
      // 스키마 정의...
    },
  },
};
```

### SDK 자동 생성
```typescript
// TypeScript SDK 생성
class RobotaAPIClient {
  private apiKey: string;
  private baseURL: string;
  
  constructor(apiKey: string, options?: ClientOptions) {
    this.apiKey = apiKey;
    this.baseURL = options?.baseURL || 'https://api.robota.dev/v1';
  }
  
  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) {
      throw new APIError(response.status, await response.text());
    }
    
    return response.json();
  }
  
  async *createChatCompletionStream(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...request, stream: true }),
    });
    
    if (!response.ok) {
      throw new APIError(response.status, await response.text());
    }
    
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            
            try {
              yield JSON.parse(data);
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
``` 