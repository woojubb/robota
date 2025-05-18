/**
 * Robota 고급 사용법 예제
 * 
 * 이 예제는 Robota의 고급 기능을 보여줍니다:
 * - 다양한 함수 호출 사용
 * - 스트리밍 응답 활용
 * - 대화 컨텍스트 유지
 * - 함수 체이닝
 * 
 * 사용하기 전에 OPENAI_API_KEY 환경 변수를 설정하세요.
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';
import chalk from 'chalk';
import OpenAI from 'openai';

// .env 파일에서 환경 변수 로드
dotenv.config();

// 타입 선언
interface WeatherData {
  temp: number;
  condition: string;
  humidity: number;
}

interface GeoLocation {
  lat: number;
  lng: number;
  name: string;
  country: string;
}

async function main() {
  // 필수 API 키 확인
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY 환경 변수를 설정해야 합니다');
    process.exit(1);
  }

  // OpenAI 인스턴스 생성
  const openai = new OpenAI({ apiKey });

  // Robota 인스턴스 생성
  const robota = new Robota({
    provider: new OpenAIProvider({
      client: openai,
      model: 'gpt-4',
      temperature: 0.7
    }),
    systemPrompt: `당신은 여행 계획 도우미입니다.
사용자가 여행과 관련된 질문을 하면 친절하게 도움을 제공하세요.
가능하면 구체적인 정보를 제공하고, 날씨나 인구 데이터 등의 구체적인 정보가 필요한 경우 함수를 활용하세요.`
  });

  // 1. 위치 검색 함수
  robota.registerFunction({
    name: 'searchLocation',
    description: '도시 또는 장소의 지리적 위치 정보를 검색합니다',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색할 도시 또는 장소명' }
      },
      required: ['query']
    }
  }, async ({ query }: { query: string }): Promise<GeoLocation> => {
    console.log(chalk.blue(`🔍 '${query}' 위치 검색 중...`));

    // 가상의 위치 데이터 (실제로는 지오코딩 API 사용)
    const mockLocations: Record<string, GeoLocation> = {
      '서울': { lat: 37.5665, lng: 126.9780, name: '서울', country: '대한민국' },
      '도쿄': { lat: 35.6762, lng: 139.6503, name: '도쿄', country: '일본' },
      '뉴욕': { lat: 40.7128, lng: -74.0060, name: '뉴욕', country: '미국' },
      '파리': { lat: 48.8566, lng: 2.3522, name: '파리', country: '프랑스' },
      '런던': { lat: 51.5074, lng: -0.1278, name: '런던', country: '영국' }
    };

    // 검색 결과 처리
    const result = mockLocations[query] || {
      lat: 0, lng: 0, name: query, country: '알 수 없음'
    };

    return result;
  });

  // 2. 날씨 조회 함수
  robota.registerFunction({
    name: 'getWeather',
    description: '특정 위치의 현재 날씨를 조회합니다',
    parameters: {
      type: 'object',
      properties: {
        lat: { type: 'number', description: '위도' },
        lng: { type: 'number', description: '경도' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: '온도 단위' }
      },
      required: ['lat', 'lng']
    }
  }, async ({ lat, lng, unit = 'celsius' }: { lat: number, lng: number, unit?: string }): Promise<WeatherData> => {
    console.log(chalk.yellow(`🌤 위도 ${lat}, 경도 ${lng}의 날씨 조회 중...`));

    // 위치 기반 가상 날씨 데이터 생성
    const mockWeather = {
      temp: Math.round(20 + Math.sin(lat / 10) * 10),
      condition: ['맑음', '흐림', '비', '안개', '눈'][Math.floor(Math.random() * 5)],
      humidity: Math.round(50 + Math.cos(lng / 20) * 30)
    };

    // 온도 단위 변환 (필요 시)
    if (unit === 'fahrenheit') {
      mockWeather.temp = Math.round(mockWeather.temp * 9 / 5 + 32);
    }

    return mockWeather;
  });

  // 3. 인구 조회 함수
  robota.registerFunction({
    name: 'getPopulation',
    description: '특정 도시나 국가의 인구 정보를 조회합니다',
    parameters: {
      type: 'object',
      properties: {
        place: { type: 'string', description: '인구를 조회할 도시 또는 국가' }
      },
      required: ['place']
    }
  }, async ({ place }: { place: string }): Promise<{ population: number, year: number }> => {
    console.log(chalk.green(`👥 '${place}'의 인구 정보 조회 중...`));

    // 가상 인구 데이터
    const mockPopulation: Record<string, number> = {
      '대한민국': 51_780_000,
      '일본': 125_800_000,
      '미국': 331_900_000,
      '프랑스': 67_390_000,
      '영국': 67_220_000,
      '서울': 9_720_000,
      '도쿄': 13_960_000,
      '뉴욕': 8_380_000,
      '파리': 2_160_000,
      '런던': 8_980_000
    };

    return {
      population: mockPopulation[place] || Math.round(Math.random() * 10_000_000),
      year: 2023
    };
  });

  try {
    // 대화형 여행 계획 시나리오 실행
    console.log(chalk.magenta('=== 여행 계획 도우미와 대화 시작 ===\n'));

    // 첫 번째 대화
    const response1 = await robota.chat('일본 도쿄 여행을 계획 중인데, 지금 날씨가 어떤가요?');
    console.log(chalk.cyan('🤖 AI:'), response1);

    // 후속 질문
    const response2 = await robota.chat('그렇군요. 도쿄의 인구는 얼마나 되나요?');
    console.log(chalk.cyan('🤖 AI:'), response2);

    // 추가 질문
    const response3 = await robota.chat('도쿄에서 관광하기 좋은 장소 5곳을 추천해주세요.');
    console.log(chalk.cyan('🤖 AI:'), response3);

    console.log(chalk.magenta('\n=== 스트리밍 모드 시연 ===\n'));
    console.log(chalk.cyan('🤖 AI: '), '');

    // 스트리밍 모드로 응답 받기
    let reply = '';
    for await (const chunk of await robota.runStream('도쿄 여행 3일 일정을 짜주세요. 유명한 관광지와 맛집을 포함해주세요.')) {
      if (chunk.content) {
        process.stdout.write(chalk.cyan(chunk.content));
        reply += chunk.content;
      }
    }

    console.log('\n');
    console.log(chalk.magenta('=== 대화 종료 ==='));

  } catch (error) {
    console.error('오류 발생:', error);
  }
}

// 예제 실행
main(); 