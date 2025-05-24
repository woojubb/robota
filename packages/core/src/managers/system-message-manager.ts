import type { Message } from '../interfaces/ai-provider';

/**
 * 시스템 메시지 관리 클래스
 * 시스템 프롬프트와 시스템 메시지들을 관리합니다.
 */
export class SystemMessageManager {
    private systemPrompt?: string;
    private systemMessages?: Message[];

    /**
     * 단일 시스템 프롬프트 설정
     * 
     * @param prompt - 시스템 프롬프트 내용
     */
    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
        this.systemMessages = undefined;
    }

    /**
     * 여러 시스템 메시지 설정
     * 
     * @param messages - 시스템 메시지 배열
     */
    setSystemMessages(messages: Message[]): void {
        this.systemPrompt = undefined;
        this.systemMessages = messages;
    }

    /**
     * 기존 시스템 메시지에 새 시스템 메시지 추가
     * 
     * @param content - 추가할 시스템 메시지 내용
     */
    addSystemMessage(content: string): void {
        // systemPrompt 설정이 있고 systemMessages가 없거나 systemPrompt 설정과 동일한 메시지 하나만 있는 경우
        if (this.systemPrompt) {
            if (!this.systemMessages ||
                (this.systemMessages.length === 1 &&
                    this.systemMessages[0].role === 'system' &&
                    this.systemMessages[0].content === this.systemPrompt)) {
                this.systemMessages = [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'system', content }
                ];
            } else {
                this.systemMessages.push({ role: 'system', content });
            }
            this.systemPrompt = undefined;
        } else {
            if (!this.systemMessages) {
                this.systemMessages = [];
            }
            this.systemMessages.push({ role: 'system', content });
        }
    }

    /**
     * 현재 시스템 프롬프트 반환
     */
    getSystemPrompt(): string | undefined {
        return this.systemPrompt;
    }

    /**
     * 현재 시스템 메시지들 반환
     */
    getSystemMessages(): Message[] | undefined {
        return this.systemMessages;
    }

    /**
     * 시스템 메시지가 설정되어 있는지 확인
     */
    hasSystemMessages(): boolean {
        return !!(this.systemPrompt || (this.systemMessages && this.systemMessages.length > 0));
    }

    /**
     * 시스템 메시지 초기화
     */
    clear(): void {
        this.systemPrompt = undefined;
        this.systemMessages = undefined;
    }
} 