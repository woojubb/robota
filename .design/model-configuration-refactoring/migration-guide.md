# 모델 설정 리팩토링 마이그레이션 가이드

## 🚨 **Breaking Changes 개요**

### **변경 사항 요약**
- **Provider Options에서 모델 관련 설정 제거**: `model`, `temperature`, `maxTokens`, `topP` 등
- **Robota의 `defaultModel`이 유일한 모델 설정 소스**: 중복 제거 및 일관성 확보
- **런타임 모델 전환 최적화**: `setModel()` 메서드 활용

### **영향받는 패키지**
- `@robota-sdk/openai`
- `@robota-sdk/anthropic` 
- `@robota-sdk/google`
- `@robota-sdk/agents`

## 📋 **마이그레이션 단계**

### **Step 1: Provider 생성 코드 수정**

#### **Before (기존 방식)** ❌
```typescript
import { OpenAIProvider } from '@robota-sdk/openai';
import { OpenAI } from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const openaiProvider = new OpenAIProvider({
    client: client,
    model: 'gpt-4',              // 🔴 제거됨
    temperature: 0.7,            // 🔴 제거됨
    maxTokens: 4000,             // 🔴 제거됨
    topP: 0.9                    // 🔴 제거됨
});
```

#### **After (새로운 방식)** ✅
```typescript
import { OpenAIProvider } from '@robota-sdk/openai';

const openaiProvider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    // 모델 관련 설정 모두 제거!
    
    // Provider 고유 설정만 유지
    organization: 'your-org-id',      // ✅ 유지
    baseURL: 'https://api.openai.com', // ✅ 유지
    timeout: 30000                    // ✅ 유지
});
```

### **Step 2: Robota 설정에서 모델 지정**

#### **Before (혼란스러운 중복)** ❌
```typescript
const robota = new Robota({
    name: 'Assistant',
    aiProviders: [openaiProvider],     // Provider에 이미 모델 설정
    defaultModel: {                    // 여기서도 모델 설정 (충돌!)
        provider: 'openai',
        model: 'gpt-3.5-turbo',        // Provider와 다른 모델?
        temperature: 0.8               // Provider와 다른 온도?
    }
});
```

#### **After (명확한 단일 소스)** ✅
```typescript
const robota = new Robota({
    name: 'Assistant',
    aiProviders: [openaiProvider],     // Provider는 연결만 담당
    defaultModel: {                    // ✅ 유일한 모델 설정 소스
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 4000,
        topP: 0.9,
        systemMessage: 'You are a helpful AI assistant.'
    }
});
```

### **Step 3: 런타임 모델 전환 활용**

#### **Before (복잡한 Provider 관리)** ❌
```typescript
// 모델마다 Provider 생성?
const gpt35Provider = new OpenAIProvider({ model: 'gpt-3.5-turbo' });
const gpt4Provider = new OpenAIProvider({ model: 'gpt-4' });

const robota = new Robota({
    aiProviders: [gpt35Provider, gpt4Provider],
    defaultModel: { provider: '???', model: '???' } // 어떻게 매핑?
});
```

#### **After (간단한 런타임 전환)** ✅
```typescript
const openaiProvider = new OpenAIProvider({ 
    apiKey: process.env.OPENAI_API_KEY 
});

const robota = new Robota({
    name: 'Assistant',
    aiProviders: [openaiProvider],
    defaultModel: { provider: 'openai', model: 'gpt-4' }
});

// 런타임에 간단하게 모델 전환
robota.setModel({ provider: 'openai', model: 'gpt-3.5-turbo' });
robota.setModel({ provider: 'openai', model: 'gpt-4-turbo' });
```

## 🔄 **패키지별 마이그레이션**

### **OpenAI Provider**

#### **Before**
```typescript
import { OpenAI } from 'openai';
import { OpenAIProvider } from '@robota-sdk/openai';

const client = new OpenAI({ apiKey: 'sk-...' });
const provider = new OpenAIProvider({
    client: client,
    model: 'gpt-4',
    temperature: 0.7,
    maxTokens: 2000
});
```

#### **After**
```typescript
import { OpenAIProvider } from '@robota-sdk/openai';

const provider = new OpenAIProvider({
    apiKey: 'sk-...',
    organization: 'your-org',  // 선택사항
    baseURL: 'custom-url',     // 선택사항
    timeout: 30000             // 선택사항
});
```

### **Anthropic Provider**

#### **Before**
```typescript
import { AnthropicProvider } from '@robota-sdk/anthropic';

const provider = new AnthropicProvider({
    apiKey: 'sk-ant-...',
    model: 'claude-3-opus',
    temperature: 0.8,
    maxTokens: 4000
});
```

#### **After**
```typescript
import { AnthropicProvider } from '@robota-sdk/anthropic';

const provider = new AnthropicProvider({
    apiKey: 'sk-ant-...',
    // 모델 관련 설정 제거
    // Provider 고유 설정만 유지
});
```

### **Google Provider**

#### **Before**
```typescript
import { GoogleProvider } from '@robota-sdk/google';

const provider = new GoogleProvider({
    apiKey: 'AI...',
    model: 'gemini-pro',
    temperature: 0.6,
    maxTokens: 3000
});
```

#### **After**
```typescript
import { GoogleProvider } from '@robota-sdk/google';

const provider = new GoogleProvider({
    apiKey: 'AI...',
    // 모델 관련 설정 제거
    // Provider 고유 설정만 유지
});
```

## 🚀 **새로운 기능 활용**

### **다중 Provider 간 모델 전환**
```typescript
const robota = new Robota({
    name: 'MultiProviderAgent',
    aiProviders: [
        new OpenAIProvider({ apiKey: 'sk-...' }),
        new AnthropicProvider({ apiKey: 'sk-ant-...' }),
        new GoogleProvider({ apiKey: 'AI...' })
    ],
    defaultModel: { provider: 'openai', model: 'gpt-4' }
});

// 실행 중 Provider와 모델 자유롭게 전환
robota.setModel({ provider: 'anthropic', model: 'claude-3-opus' });
robota.setModel({ provider: 'google', model: 'gemini-pro' });
robota.setModel({ provider: 'openai', model: 'gpt-4-turbo' });
```

### **세밀한 모델 설정 제어**
```typescript
// 상황에 따른 모델 설정 변경
robota.setModel({
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.2,    // 정확한 답변이 필요할 때
    maxTokens: 1000
});

robota.setModel({
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.9,    // 창의적인 답변이 필요할 때
    maxTokens: 4000
});
```

## ⚠️ **주의사항**

### **타입 에러 해결**
```typescript
// 기존 코드에서 타입 에러가 발생할 수 있음
const provider = new OpenAIProvider({
    model: 'gpt-4'  // ❌ Property 'model' does not exist
});

// 해결: 모델 설정을 Robota로 이동
const provider = new OpenAIProvider({ apiKey: 'sk-...' });
const robota = new Robota({
    aiProviders: [provider],
    defaultModel: { provider: 'openai', model: 'gpt-4' }  // ✅
});
```

### **기본값 처리**
```typescript
// Provider별 기본 모델이 없으므로 반드시 defaultModel 지정
const robota = new Robota({
    aiProviders: [provider],
    // defaultModel 생략하면 에러!
    defaultModel: {          // ✅ 필수
        provider: 'openai',
        model: 'gpt-4'
    }
});
```

## 🎯 **마이그레이션 체크리스트**

### **코드 수정**
- [ ] 모든 Provider 생성 코드에서 모델 관련 옵션 제거
- [ ] `defaultModel` 설정에 모든 모델 관련 설정 이동
- [ ] 런타임 모델 전환이 필요한 곳에 `setModel()` 사용

### **테스트 수정**
- [ ] Provider 생성 테스트에서 모델 관련 옵션 제거
- [ ] `defaultModel` 기반 테스트로 변경
- [ ] 런타임 모델 전환 테스트 추가

### **문서 업데이트**
- [ ] README 파일의 예제 코드 수정
- [ ] API 문서 업데이트
- [ ] 마이그레이션 가이드 팀과 공유

## 🎉 **마이그레이션 완료 후 이점**

### **개발자 경험 개선**
- **명확성**: 모델 설정이 어디에 있는지 즉시 파악
- **일관성**: 모든 Provider가 동일한 패턴
- **유연성**: 런타임 모델 전환이 더 간단

### **코드 품질 향상**
- **중복 제거**: 모델 설정 한 곳에서만 관리
- **유지보수성**: 설정 변경 시 한 곳만 수정
- **확장성**: 새로운 Provider 추가 시 일관된 방식

### **기능 강화**
- **다중 모델 지원**: 하나의 Provider로 여러 모델 사용
- **동적 전환**: 실행 중 자유로운 모델 전환
- **설정 제어**: 상황별 세밀한 모델 설정 가능 