---
title: OpenAPI Integration
description: Using OpenAPI specifications with Robota
lang: en-US
---

# OpenAPI Integration

Robota provides functionality to automatically convert OpenAPI (formerly Swagger) specifications into tools and functions for AI agents. This allows you to easily connect and leverage existing APIs with AI agents.

## What is OpenAPI?

OpenAPI is a standardized specification for describing RESTful APIs, defining API endpoints, request parameters, response formats, etc. in JSON or YAML format. This specification enables API documentation generation, client code generation, API testing, and more.

## Robota's OpenAPI Integration

Robota analyzes OpenAPI specifications to automatically convert each API endpoint into a function that can be used by AI agents. Through these converted functions, AI can directly call APIs and process the results.

## Creating OpenAPI Tools

### Loading OpenAPI Specs from URL

```typescript
import { Robota, OpenAIProvider, OpenAPIToolkit } from 'robota';

// Create tools from OpenAPI spec
const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json');

// Create Robota instance and register tools
const robota = new Robota({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
});

robota.registerTools(apiTools);

// Now AI can call the API
const result = await robota.run('What is the weather today?');
```

### Loading OpenAPI Specs from Local File

```typescript
import { Robota, OpenAIProvider, OpenAPIToolkit } from 'robota';
import fs from 'fs';

// Load OpenAPI spec from local file
const specPath = './api-specs/weather-api.json';
const apiSpec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

// Create tools from OpenAPI spec
const apiTools = await OpenAPIToolkit.fromSpec(apiSpec);

// Register tools with Robota instance
const robota = new Robota({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
});

robota.registerTools(apiTools);
```

## API Authentication Setup

Many APIs require authentication. Robota supports various authentication methods:

```typescript
import { Robota, OpenAPIToolkit, APIAuthentication } from 'robota';

// API Key authentication
const apiKeyAuth = new APIAuthentication.ApiKey({
  name: 'api_key',
  value: process.env.API_KEY,
  in: 'header' // One of 'header', 'query', 'cookie'
});

// Bearer token authentication
const bearerAuth = new APIAuthentication.Bearer({
  token: process.env.BEARER_TOKEN
});

// Basic authentication
const basicAuth = new APIAuthentication.Basic({
  username: process.env.API_USERNAME,
  password: process.env.API_PASSWORD
});

// OAuth2 authentication
const oauthAuth = new APIAuthentication.OAuth2({
  token: process.env.OAUTH_TOKEN
});

// Create tools with authentication information
const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  authentication: apiKeyAuth
});
```

## Fine-grained API Access Control

You can limit which API endpoints are exposed to the AI:

```typescript
import { Robota, OpenAPIToolkit } from 'robota';

// Include only specific paths
const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  includePaths: ['/weather/*', '/locations/search'],
  excludePaths: ['/admin/*', '/users/*']
});
```

## Endpoint Renaming and Description Enhancement

You can provide clearer tool names and descriptions:

```typescript
import { Robota, OpenAPIToolkit } from 'robota';

const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  nameMapping: {
    '/weather/{city}': 'getWeatherByCity',
    '/locations/search': 'searchLocations'
  },
  descriptionEnhancement: {
    '/weather/{city}': 'Get current weather information for the specified city. City names can be entered in English or other languages.'
  }
});
```

## Response Transformation and Post-processing

API responses can be processed to provide more useful formats to the AI:

```typescript
import { Robota, OpenAPIToolkit } from 'robota';

const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  responseTransformers: {
    '/weather/{city}': (response) => {
      // Transform response data
      return {
        temperature: response.data.temp,
        condition: response.data.weather[0].description,
        location: response.data.name,
        summary: `The current weather in ${response.data.name} is ${response.data.weather[0].description} with a temperature of ${response.data.temp}°C.`
      };
    }
  }
});
```

## Error Handling

Errors that occur during API calls can be appropriately handled:

```typescript
import { Robota, OpenAPIToolkit } from 'robota';

const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json', {
  errorHandlers: {
    '/weather/{city}': (error) => {
      if (error.response?.status === 404) {
        return { error: 'City not found. Please check the city name.' };
      }
      if (error.response?.status === 401) {
        return { error: 'API key is invalid.' };
      }
      return { error: 'An error occurred while fetching weather information.' };
    }
  }
});
```

## Real-World Example

An agent implementation using a weather API defined with OpenAPI:

```typescript
import { Robota, OpenAIProvider, OpenAPIToolkit } from 'robota';
import dotenv from 'dotenv';
dotenv.config();

async function createWeatherAgent() {
  // Create weather API tools
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

  // Create Robota instance and register tools
  const robota = new Robota({
    provider: new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4'
    }),
    systemPrompt: 'You are a weather information assistant. Provide useful weather information to the user.'
  });

  robota.registerTools(weatherTools);
  
  return robota;
}

// Use weather agent
async function main() {
  const weatherAgent = await createWeatherAgent();
  
  const result = await weatherAgent.run('What is the weather like in Seoul today? And is it going to rain tomorrow?');
  console.log(result);
}

main().catch(console.error);
``` 