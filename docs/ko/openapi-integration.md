# OpenAPI 통합

Robota는 OpenAPI(이전의 Swagger) 스펙을 자동으로 AI 에이전트의 도구와 함수로 변환하는 기능을 제공합니다. 이를 통해 기존 API를 쉽게 AI 에이전트에 연결하고 활용할 수 있습니다.

## OpenAPI란?

OpenAPI는 RESTful API를 설명하기 위한 표준화된 스펙으로, API의 엔드포인트, 요청 매개변수, 응답 형식 등을 JSON 또는 YAML 형식으로 정의합니다. 이 스펙을 통해 API 문서 생성, 클라이언트 코드 생성, API 테스트 등이 가능합니다.

## Robota의 OpenAPI 통합 기능

Robota는 OpenAPI 스펙을 분석하여 각 API 엔드포인트를 AI 에이전트가 사용할 수 있는 함수로 자동 변환합니다. 이렇게 변환된 함수를 통해 AI는 API를 직접 호출하고 결과를 처리할 수 있습니다.

## OpenAPI 도구 생성하기

### URL에서 OpenAPI 스펙 로드

```typescript
import { Robota, OpenAIProvider, OpenAPIToolkit } from 'robota';

// OpenAPI 스펙에서 도구 생성
const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json');

// Robota 인스턴스 생성 및 도구 등록
const robota = new Robota({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
});

robota.registerTools(apiTools);

// 이제 AI는 API를 호출할 수 있습니다
const result = await robota.run('오늘 날씨가 어떤가요?');
```

### 로컬 파일에서 OpenAPI 스펙 로드

```typescript
import { Robota, OpenAIProvider, OpenAPIToolkit } from 'robota';
import fs from 'fs';

// 로컬 파일에서 OpenAPI 스펙 로드
const specPath = './api-specs/weather-api.json';
const apiSpec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

// OpenAPI 스펙에서 도구 생성
const apiTools = await OpenAPIToolkit.fromSpec(apiSpec);

// Robota 인스턴스에 도구 등록
const robota = new Robota({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
});

robota.registerTools(apiTools);
```

## API 인증 설정

많은 API는 인증이 필요합니다. Robota는 다양한 인증 방식을 지원합니다:

```typescript
import { Robota, OpenAPIToolkit, APIAuthentication } from 'robota';

// API 키 인증
const apiKeyAuth = new APIAuthentication.ApiKey({
  name: 'api_key',
  value: process.env.API_KEY,
  in: 'header' // 'header', 'query', 'cookie' 중 하나
});

// Bearer 토큰 인증
const bearerAuth = new APIAuthentication.Bearer({
  token: process.env.BEARER_TOKEN
});

// 기본 인증
const basicAuth = new APIAuthentication.Basic({
  username: process.env.API_USERNAME,
  password: process.env.API_PASSWORD
});

// OAuth2 인증
const oauthAuth = new APIAuthentication.OAuth2({
  token: process.env.OAUTH_TOKEN
});

// 인증 정보와 함께 도구 생성
const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  authentication: apiKeyAuth
});
```

## 세분화된 API 액세스 제어

특정 API 엔드포인트만 AI에게 노출하도록 제한할 수 있습니다:

```typescript
import { Robota, OpenAPIToolkit } from 'robota';

// 특정 경로만 포함
const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  includePaths: ['/weather/*', '/locations/search'],
  excludePaths: ['/admin/*', '/users/*']
});
```

## 엔드포인트 이름 변경 및 설명 추가

더 명확한 도구 이름과 설명을 제공할 수 있습니다:

```typescript
import { Robota, OpenAPIToolkit } from 'robota';

const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  nameMapping: {
    '/weather/{city}': 'getWeatherByCity',
    '/locations/search': 'searchLocations'
  },
  descriptionEnhancement: {
    '/weather/{city}': '지정된 도시의 현재 날씨 정보를 가져옵니다. 도시 이름은 한글 또는 영어로 입력할 수 있습니다.'
  }
});
```

## 응답 변환 및 후처리

API 응답을 가공하여 AI에게 더 유용한 형태로 제공할 수 있습니다:

```typescript
import { Robota, OpenAPIToolkit } from 'robota';

const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  responseTransformers: {
    '/weather/{city}': (response) => {
      // 응답 데이터 변환
      return {
        temperature: response.data.temp,
        condition: response.data.weather[0].description,
        location: response.data.name,
        summary: `${response.data.name}의 현재 날씨는 ${response.data.weather[0].description}이고, 기온은 ${response.data.temp}°C입니다.`
      };
    }
  }
});
```

## 에러 처리

API 호출 중 발생하는 오류를 적절히 처리할 수 있습니다:

```typescript
import { Robota, OpenAPIToolkit } from 'robota';

const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  errorHandlers: {
    '/weather/{city}': (error) => {
      if (error.response?.status === 404) {
        return { error: '도시를 찾을 수 없습니다. 도시 이름을 다시 확인해주세요.' };
      }
      if (error.response?.status === 401) {
        return { error: 'API 키가 유효하지 않습니다.' };
      }
      return { error: '날씨 정보를 가져오는 중 오류가 발생했습니다.' };
    }
  }
});
```

## 실제 사용 예시

OpenAPI로 정의된 날씨 API를 활용하는 에이전트 구현:

```typescript
import { Robota, OpenAIProvider, OpenAPIToolkit } from 'robota';
import dotenv from 'dotenv';
dotenv.config();

async function createWeatherAgent() {
  // 날씨 API 도구 생성
  const weatherTools = await OpenAPIToolkit.fromURL('https://api.weatherapi.com/v1/openapi.json', {
    authentication: new APIAuthentication.ApiKey({
      name: 'key',
      value: process.env.WEATHER_API_KEY,
      in: 'query'
    }),
    includePaths: ['/current.json', '/forecast.json'],
    nameMapping: {
      '/current.json': 'getCurrentWeather',
      '/forecast.json': 'getWeatherForecast'
    }
  });

  // Robota 인스턴스 생성 및 도구 등록
  const robota = new Robota({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4'
    }),
    systemPrompt: '당신은 날씨 정보를 제공하는 도우미입니다. 사용자에게 유용한 날씨 정보를 알려주세요.'
  });

  robota.registerTools(weatherTools);
  
  return robota;
}

// 날씨 에이전트 사용
async function main() {
  const weatherAgent = await createWeatherAgent();
  
  const result = await weatherAgent.run('서울의 오늘 날씨는 어때? 그리고 내일은 비가 올 예정이야?');
  console.log(result);
}

main().catch(console.error);
``` 