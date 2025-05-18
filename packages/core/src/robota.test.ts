import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Robota } from './robota';
import { SimpleMemory } from './memory';
import type { Message, Context, ModelResponse } from './types';

// 테스트를 위한 모델 컨텍스트 프로토콜 인터페이스
interface ModelContextProtocol {
    options: { model: string };
    chat(context: Context): Promise<ModelResponse>;
    chatStream(context: Context): AsyncGenerator<any, void, unknown>;
    formatMessages(messages: Message[]): any;
    formatFunctions(functions: any[]): any;
    parseResponse(response: any): ModelResponse;
    parseStreamingChunk(chunk: any): any;
}

// 테스트를 위한 가짜 제공업체 구현
class MockProvider implements ModelContextProtocol {
    public options = { model: 'mock-model' };
    public lastContext: Context | null = null;
    public mockResponse: ModelResponse = { content: '안녕하세요!' };
    public mockOptions: any = {};

    async chat(context: Context, options?: any): Promise<ModelResponse> {
        this.lastContext = context;
        this.mockOptions = options || {};
        return this.mockResponse;
    }

    async *chatStream(context: Context, options?: any): AsyncGenerator<any, void, unknown> {
        this.lastContext = context;
        this.mockOptions = options || {};
        yield { content: '안녕', isComplete: false };
        yield { content: '하세요', isComplete: true };
    }

    formatMessages(messages: Message[]): any {
        return messages;
    }

    formatFunctions(functions: any[]): any {
        return functions;
    }

    parseResponse(response: any): ModelResponse {
        return response;
    }

    parseStreamingChunk(chunk: any): any {
        return chunk;
    }
}

describe('Robota', () => {
    let mockProvider: MockProvider;
    let robota: Robota;

    beforeEach(() => {
        mockProvider = new MockProvider();
        robota = new Robota({ provider: mockProvider });
    });

    describe('초기화', () => {
        it('기본 옵션으로 초기화되어야 함', () => {
            expect(robota['provider']).toBe(mockProvider);
            expect(robota['memory']).toBeInstanceOf(SimpleMemory);
            expect(robota['systemPrompt']).toBeUndefined();
        });

        it('사용자 정의 옵션으로 초기화되어야 함', () => {
            const customSystemPrompt = '당신은 도움이 되는 AI입니다.';
            const customMemory = new SimpleMemory();

            const customRobota = new Robota({
                provider: mockProvider,
                systemPrompt: customSystemPrompt,
                memory: customMemory
            });

            expect(customRobota['provider']).toBe(mockProvider);
            expect(customRobota['memory']).toBe(customMemory);
            expect(customRobota['systemPrompt']).toBe(customSystemPrompt);
        });

        it('시스템 메시지 배열로 초기화되어야 함', () => {
            const systemMessages = [
                { role: 'system' as const, content: '당신은 전문가입니다.' },
                { role: 'system' as const, content: '정확한 정보를 제공하세요.' }
            ];

            const customRobota = new Robota({
                provider: mockProvider,
                systemMessages
            });

            expect(customRobota['systemMessages']).toEqual(systemMessages);
            expect(customRobota['systemPrompt']).toBeUndefined();
        });

        it('함수 호출 설정으로 초기화되어야 함', () => {
            const functionCallConfig = {
                defaultMode: 'auto' as const,
                maxCalls: 5,
                timeout: 10000,
                allowedFunctions: ['getWeather']
            };

            const customRobota = new Robota({
                provider: mockProvider,
                functionCallConfig
            });

            expect(customRobota['functionCallConfig'].defaultMode).toBe('auto');
            expect(customRobota['functionCallConfig'].maxCalls).toBe(5);
            expect(customRobota['functionCallConfig'].timeout).toBe(10000);
            expect(customRobota['functionCallConfig'].allowedFunctions).toEqual(['getWeather']);
        });
    });

    describe('run 메서드', () => {
        it('문자열 입력으로 실행할 수 있어야 함', async () => {
            const result = await robota.run('안녕하세요');

            // 제공업체에 올바른 컨텍스트가 전달되었는지 확인
            expect(mockProvider.lastContext).not.toBeNull();

            // messages 배열에 사용자 메시지가 포함되어 있는지 확인
            const userMessages = mockProvider.lastContext?.messages.filter(msg => msg.role === 'user');
            expect(userMessages).toHaveLength(1);
            expect(userMessages?.[0]).toEqual({
                role: 'user',
                content: '안녕하세요'
            });

            // 응답이 올바르게 반환되었는지 확인
            expect(result).toBe('안녕하세요!');
        });

        it('옵션을 전달할 수 있어야 함', async () => {
            mockProvider.mockResponse = { content: '맞춤형 응답' };

            const result = await robota.run('안녕하세요', {
                systemPrompt: '사용자 질문에 정확히 답변하세요.',
                temperature: 0.5
            });

            expect(mockProvider.lastContext?.systemPrompt).toBe('사용자 질문에 정확히 답변하세요.');
            expect(result).toBe('맞춤형 응답');
        });
    });

    describe('chat 메서드', () => {
        it('채팅 기록을 유지해야 함', async () => {
            mockProvider.mockResponse = { content: '첫 번째 응답' };
            await robota.chat('첫 번째 메시지');

            // 사용자 메시지와 응답이 메모리에 저장되었는지 확인
            expect(robota['memory'].getMessages()).toHaveLength(2);
            expect(robota['memory'].getMessages()[0]).toEqual({
                role: 'user',
                content: '첫 번째 메시지'
            });
            expect(robota['memory'].getMessages()[1]).toEqual({
                role: 'assistant',
                content: '첫 번째 응답'
            });

            // 두 번째 메시지 전송
            mockProvider.mockResponse = { content: '두 번째 응답' };
            await robota.chat('두 번째 메시지');

            // 전체 대화 기록 확인
            expect(robota['memory'].getMessages()).toHaveLength(4);
            expect(robota['memory'].getMessages()[2]).toEqual({
                role: 'user',
                content: '두 번째 메시지'
            });
            expect(robota['memory'].getMessages()[3]).toEqual({
                role: 'assistant',
                content: '두 번째 응답'
            });
        });
    });

    describe('함수 호출', () => {
        it('함수 호출 모드를 설정할 수 있어야 함', async () => {
            // 함수 호출 모드 설정
            robota.setFunctionCallMode('auto');
            expect(robota['functionCallConfig'].defaultMode).toBe('auto');

            await robota.run('테스트 메시지');
            expect(mockProvider.mockOptions.functionCallMode).toBe('auto');

            // 다른 모드로 변경
            robota.setFunctionCallMode('disabled');
            expect(robota['functionCallConfig'].defaultMode).toBe('disabled');

            await robota.run('테스트 메시지');
            expect(mockProvider.mockOptions.functionCallMode).toBe('disabled');
        });

        it('run 메서드에서 함수 호출 모드를 재정의할 수 있어야 함', async () => {
            // 기본 모드 설정
            robota.setFunctionCallMode('auto');

            // 실행 시 재정의
            await robota.run('테스트 메시지', { functionCallMode: 'disabled' });
            expect(mockProvider.mockOptions.functionCallMode).toBe('disabled');

            // 다시 기본 모드로 실행
            await robota.run('테스트 메시지');
            expect(mockProvider.mockOptions.functionCallMode).toBe('auto');
        });

        it('force 모드에서 강제 함수와 인자를 지정할 수 있어야 함', async () => {
            const forcedFunction = 'getWeather';
            const forcedArguments = { location: '서울' };

            await robota.run('안녕하세요', {
                functionCallMode: 'force',
                forcedFunction,
                forcedArguments
            });

            expect(mockProvider.mockOptions.functionCallMode).toBe('force');
            expect(mockProvider.mockOptions.forcedFunction).toBe(forcedFunction);
            expect(mockProvider.mockOptions.forcedArguments).toEqual(forcedArguments);
        });

        it('configureFunctionCall로 함수 호출 설정을 변경할 수 있어야 함', async () => {
            robota.configureFunctionCall({
                mode: 'auto',
                maxCalls: 5,
                timeout: 10000,
                allowedFunctions: ['getWeather', 'calculate']
            });

            await robota.run('안녕하세요');

            expect(robota['functionCallConfig'].defaultMode).toBe('auto');
            expect(robota['functionCallConfig'].maxCalls).toBe(5);
            expect(robota['functionCallConfig'].timeout).toBe(10000);
            expect(robota['functionCallConfig'].allowedFunctions).toEqual(['getWeather', 'calculate']);
            expect(mockProvider.mockOptions.functionCallMode).toBe('auto');
        });
    });

    describe('시스템 메시지', () => {
        it('setSystemPrompt로 단일 시스템 메시지를 설정할 수 있어야 함', async () => {
            const systemPrompt = '당신은 도움이 되는 AI 비서입니다.';
            robota.setSystemPrompt(systemPrompt);

            await robota.run('안녕하세요');

            expect(robota['systemPrompt']).toBe(systemPrompt);
            expect(robota['systemMessages']).toEqual([{ role: 'system', content: systemPrompt }]);

            // 시스템 메시지가 컨텍스트에 포함되었는지 확인
            const messages = mockProvider.lastContext?.messages || [];
            expect(messages.length).toBeGreaterThan(1);
            expect(messages[0]).toEqual({ role: 'system', content: systemPrompt });
        });

        it('setSystemMessages로 여러 시스템 메시지를 설정할 수 있어야 함', async () => {
            const systemMessages = [
                { role: 'system' as const, content: '당신은 전문가입니다.' },
                { role: 'system' as const, content: '정확한 정보를 제공하세요.' }
            ];

            robota.setSystemMessages(systemMessages);

            await robota.run('안녕하세요');

            expect(robota['systemPrompt']).toBeUndefined();
            expect(robota['systemMessages']).toEqual(systemMessages);

            // 시스템 메시지가 컨텍스트에 포함되었는지 확인
            const messages = mockProvider.lastContext?.messages || [];
            expect(messages.length).toBeGreaterThan(2);
            expect(messages[0]).toEqual(systemMessages[0]);
            expect(messages[1]).toEqual(systemMessages[1]);
        });

        it('addSystemMessage로 시스템 메시지를 추가할 수 있어야 함', async () => {
            robota.setSystemPrompt('당신은 도움이 되는 AI 비서입니다.');
            robota.addSystemMessage('사용자에게 공손하게 대응하세요.');

            await robota.run('안녕하세요');

            expect(robota['systemPrompt']).toBeUndefined();
            expect(robota['systemMessages']).toEqual([
                { role: 'system', content: '당신은 도움이 되는 AI 비서입니다.' },
                { role: 'system', content: '사용자에게 공손하게 대응하세요.' }
            ]);

            // 시스템 메시지가 컨텍스트에 포함되었는지 확인
            const messages = mockProvider.lastContext?.messages || [];
            expect(messages.length).toBeGreaterThan(2);
            expect(messages[0]).toEqual({ role: 'system', content: '당신은 도움이 되는 AI 비서입니다.' });
            expect(messages[1]).toEqual({ role: 'system', content: '사용자에게 공손하게 대응하세요.' });
        });
    });
}); 