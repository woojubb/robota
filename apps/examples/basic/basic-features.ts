/**
 * Robota 기본 사용법 예제
 * 
 * 이 예제는 Robota의 기본 사용법을 보여줍니다:
 * - OpenAI 제공업체 설정
 * - 기본 채팅 수행하기
 * - 함수 호출 사용하기
 * 
 * 사용하기 전에 OPENAI_API_KEY 환경 변수를 설정하세요.
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// .env 파일에서 환경 변수 로드
dotenv.config();

async function main() {
  // 필수 API 키 확인
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY 환경 변수를 설정해야 합니다');
    process.exit(1);
  }
  
  // Robota 인스턴스 생성
  const robota = new Robota({
    provider: new OpenAIProvider({
      apiKey,
      model: 'gpt-4',
      temperature: 0.7
    }),
    systemPrompt: '당신은 도움이 되는 AI 비서입니다. 사용자의 질문에 정확하고 간결하게 답변해주세요.'
  });
  
  // 날씨 조회 함수 정의
  robota.registerFunction({
    name: 'getWeather',
    description: '특정 도시의 현재 날씨를 조회합니다',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '날씨를 조회할 도시명' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: '온도 단위' }
      },
      required: ['city']
    }
  }, async ({ city, unit = 'celsius' }) => {
    // 실제로는 날씨 API를 호출해야 하지만, 이 예제에서는 가상 데이터 반환
    console.log(`${city}의 날씨를 ${unit} 단위로 조회합니다...`);
    
    // 도시별 가상 날씨 데이터
    const weatherData = {
      '서울': { temp: 22, condition: '맑음', humidity: 60 },
      '부산': { temp: 24, condition: '흐림', humidity: 70 },
      '뉴욕': { temp: 18, condition: '비', humidity: 80 },
      '런던': { temp: 16, condition: '안개', humidity: 75 }
    };
    
    // 기본 응답
    const defaultResponse = { temp: 20, condition: '맑음', humidity: 65 };
    
    // 온도 단위 변환 (필요 시)
    const weather = weatherData[city] || defaultResponse;
    if (unit === 'fahrenheit') {
      weather.temp = Math.round(weather.temp * 9/5 + 32);
    }
    
    return weather;
  });
  
  try {
    // 단순 질문하기
    const result1 = await robota.run('안녕하세요!');
    console.log('AI 응답:', result1);
    
    // 날씨 함수를 사용하는 질문
    const result2 = await robota.run('서울의 현재 날씨가 어떤가요?');
    console.log('AI 응답:', result2);
    
    // 다른 도시 날씨 + 화씨 온도 요청
    const result3 = await robota.run('뉴욕의 날씨를 화씨로 알려주세요.');
    console.log('AI 응답:', result3);
    
  } catch (error) {
    console.error('오류 발생:', error);
  }
}

// 예제 실행
main(); 