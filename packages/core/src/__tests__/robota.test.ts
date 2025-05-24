import { describe, it, expect, beforeEach } from 'vitest';
import { Robota } from '../robota';
import { SimpleConversationHistory } from '../conversation-history';
import type { Context, ModelResponse, AIProvider } from '../interfaces/ai-provider';

// Mock AI Provider 클래스
class MockProvider implements AIProvider {
    public name = 'mock';
    public availableModels = ['mock-model'];
    public lastContext: Context | null = null;
    public mockResponse: ModelResponse = { content: '안녕하세요!' };
    public mockOptions: any = {};

    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        this.lastContext = context;
        this.mockOptions = options || {};
        return this.mockResponse;
    }

    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<any, void, unknown> {
        this.lastContext = context;
        this.mockOptions = options || {};
        const chunk = { content: this.mockResponse.content };
        yield chunk;
    }
}

describe('Robota', () => {
    let mockProvider: MockProvider;
    let robota: Robota;

    beforeEach(() => {
        mockProvider = new MockProvider();
        robota = new Robota({
            aiProviders: { mock: mockProvider },
            currentProvider: 'mock',
            currentModel: 'mock-model'
        });
    });

    describe('초기화', () => {
        it('기본 옵션으로 초기화되어야 함', () => {
            expect(robota.getCurrentAI()).toEqual({ provider: 'mock', model: 'mock-model' });
            expect(robota['conversationHistory']).toBeInstanceOf(SimpleConversationHistory);
        });

        it('사용자 정의 옵션으로 초기화되어야 함', () => {
            const customSystemPrompt = '당신은 도움이 되는 AI입니다.';
            const customConversationHistory = new SimpleConversationHistory();

            const customRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                systemPrompt: customSystemPrompt,
                conversationHistory: customConversationHistory
            });

            expect(customRobota.getCurrentAI()).toEqual({ provider: 'mock', model: 'mock-model' });
            expect(customRobota['conversationHistory']).toBe(customConversationHistory);
        });

        it('시스템 메시지 배열로 초기화되어야 함', () => {
            const systemMessages = [
                { role: 'system' as const, content: '당신은 전문가입니다.' },
                { role: 'system' as const, content: '정확한 정보를 제공하세요.' }
            ];

            const customRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                systemMessages
            });

            expect(customRobota['systemMessageManager'].getSystemMessages()).toEqual(systemMessages);
        });

        it('함수 호출 설정으로 초기화되어야 함', () => {
            const functionCallConfig = {
                defaultMode: 'auto' as const,
                maxCalls: 5,
                timeout: 10000,
                allowedFunctions: ['getWeather']
            };

            const customRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                functionCallConfig
            });

            expect(customRobota['functionCallManager'].getDefaultMode()).toBe('auto');
            expect(customRobota['functionCallManager'].getMaxCalls()).toBe(5);
            expect(customRobota['functionCallManager'].getTimeout()).toBe(10000);
            expect(customRobota['functionCallManager'].getAllowedFunctions()).toEqual(['getWeather']);
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
            expect(userMessages?.[0]).toMatchObject({
                role: 'user',
                content: '안녕하세요'
            });
            expect((userMessages?.[0] as any).timestamp).toBeInstanceOf(Date);

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

            // 사용자 메시지와 응답이 대화 기록에 저장되었는지 확인
            expect(robota['conversationHistory'].getMessageCount()).toBe(2);
            const messages = robota['conversationHistory'].getMessages();
            expect(messages[0].role).toBe('user');
            expect(messages[0].content).toBe('첫 번째 메시지');
            expect(messages[1].role).toBe('assistant');
            expect(messages[1].content).toBe('첫 번째 응답');

            // 두 번째 메시지 전송
            mockProvider.mockResponse = { content: '두 번째 응답' };
            await robota.chat('두 번째 메시지');

            // 전체 대화 기록 확인
            const allMessages = robota['conversationHistory'].getMessages();
            expect(allMessages).toHaveLength(4);
            expect(allMessages[2].role).toBe('user');
            expect(allMessages[2].content).toBe('두 번째 메시지');
            expect(allMessages[3].role).toBe('assistant');
            expect(allMessages[3].content).toBe('두 번째 응답');
        });
    });

    describe('함수 호출', () => {
        it('함수 호출 모드를 설정할 수 있어야 함', async () => {
            // 함수 호출 모드 설정
            robota.setFunctionCallMode('auto');
            expect(robota['functionCallManager'].getDefaultMode()).toBe('auto');

            await robota.run('테스트 메시지');
            expect(mockProvider.mockOptions.functionCallMode).toBe('auto');

            // 다른 모드로 변경
            robota.setFunctionCallMode('disabled');
            expect(robota['functionCallManager'].getDefaultMode()).toBe('disabled');

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

            expect(robota['functionCallManager'].getDefaultMode()).toBe('auto');
            expect(robota['functionCallManager'].getMaxCalls()).toBe(5);
            expect(robota['functionCallManager'].getTimeout()).toBe(10000);
            expect(robota['functionCallManager'].getAllowedFunctions()).toEqual(['getWeather', 'calculate']);
            expect(mockProvider.mockOptions.functionCallMode).toBe('auto');
        });
    });

    describe('시스템 메시지', () => {
        it('setSystemPrompt로 단일 시스템 메시지를 설정할 수 있어야 함', async () => {
            const systemPrompt = '당신은 전문가입니다.';
            robota.setSystemPrompt(systemPrompt);

            await robota.run('안녕하세요');

            expect(mockProvider.lastContext?.systemPrompt).toBe(systemPrompt);
        });

        it('setSystemMessages로 여러 시스템 메시지를 설정할 수 있어야 함', async () => {
            const systemMessages = [
                { role: 'system' as const, content: '당신은 전문가입니다.' },
                { role: 'system' as const, content: '정확한 정보를 제공하세요.' }
            ];

            robota.setSystemMessages(systemMessages);

            await robota.run('안녕하세요');

            expect(mockProvider.lastContext?.systemMessages).toEqual(systemMessages);
        });

        it('addSystemMessage로 시스템 메시지를 추가할 수 있어야 함', async () => {
            robota.setSystemPrompt('당신은 전문가입니다.');
            robota.addSystemMessage('정확한 정보를 제공하세요.');

            await robota.run('안녕하세요');

            const expectedMessages = [
                { role: 'system', content: '당신은 전문가입니다.' },
                { role: 'system', content: '정확한 정보를 제공하세요.' }
            ];
            expect(mockProvider.lastContext?.systemMessages).toEqual(expectedMessages);
        });
    });
}); 