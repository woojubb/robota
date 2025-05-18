/**
 * 유틸리티 함수 모음
 */

/**
 * 문자열을 청크로 나누는 함수
 * 
 * @param text 나눌 문자열
 * @param chunkSize 각 청크의 최대 크기
 * @returns 문자열 청크 배열
 */
export function splitTextIntoChunks(text: string, chunkSize: number): string[] {
  const chunks: string[] = [];

  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }

  return chunks;
}

/**
 * 객체에서 undefined 값을 제거하는 함수
 * 
 * @param obj 정리할 객체
 * @returns undefined 값이 제거된 객체
 */
export function removeUndefined<T extends Record<string, any>>(obj: T): T {
  const result = { ...obj };

  for (const key in result) {
    if (result[key] === undefined) {
      delete result[key];
    } else if (typeof result[key] === 'object' && result[key] !== null) {
      result[key] = removeUndefined(result[key]);
    }
  }

  return result;
}

/**
 * 문자열이 JSON인지 확인하는 함수
 * 
 * @param str 확인할 문자열
 * @returns JSON 여부
 */
export function isJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 지연 함수
 * 
 * @param ms 지연 시간(밀리초)
 * @returns Promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 토큰 수 대략적 추정 함수
 * 
 * @param text 측정할 텍스트
 * @returns 대략적인 토큰 수
 */
export function estimateTokenCount(text: string): number {
  // 영어 기준으로 토큰은 대략 단어 수의 1.3배
  // 한국어는 글자 단위로 토큰화되므로 글자 수에 가까움
  // 여기서는 간단한 추정을 위해 단어 수와 글자 수의 조합 사용

  // 영어 단어 추출
  const englishWords = text.match(/[a-zA-Z]+/g)?.length || 0;

  // 한글 글자 추출
  const koreanChars = text.match(/[가-힣]/g)?.length || 0;

  // 숫자 및 특수문자
  const others = text.length - (text.match(/[a-zA-Z가-힣]/g)?.join('').length || 0);

  return Math.ceil(englishWords * 1.3 + koreanChars + others * 0.5);
}

/**
 * 문자열 스트림에서 완성된 JSON 객체를 추출하는 함수
 * 
 * @param text JSON 문자열 조각
 * @returns 완성된 JSON 객체와 남은 문자열
 */
export function extractJSONObjects(text: string): { objects: any[], remaining: string } {
  const objects: any[] = [];
  let remaining = text;
  let match;

  // JSON 객체 탐색을 위한 정규식
  // 정확한 JSON 추출을 위한 간단한 방법이지만, 중첩된 객체에서는 실패할 수 있음
  const regex = /{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*}/g;

  while ((match = regex.exec(remaining)) !== null) {
    try {
      const jsonStr = match[0];
      const jsonObj = JSON.parse(jsonStr);
      objects.push(jsonObj);

      // 매칭된 부분을 제거
      remaining = remaining.slice(0, match.index) + remaining.slice(match.index + jsonStr.length);

      // 정규식 인덱스 리셋
      regex.lastIndex = 0;
    } catch (e) {
      // 유효하지 않은 JSON은 무시
      regex.lastIndex = match.index + 1;
    }
  }

  return { objects, remaining };
}

/**
 * logger 유틸리티 (console.log 대체)
 */
export const logger = {
  info: (...args: any[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[INFO]', ...args);
    }
  },
  warn: (...args: any[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[WARN]', ...args);
    }
  },
  error: (...args: any[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ERROR]', ...args);
    }
  }
}; 