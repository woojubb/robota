import type { Message } from './types';

/**
 * 메모리 인터페이스
 * 
 * 메모리는 대화 이력을 저장하고 관리하는 역할을 합니다.
 */
export interface Memory {
  /**
   * 메모리에 메시지를 추가합니다.
   */
  addMessage(message: Message): void;
  
  /**
   * 저장된 모든 메시지를 가져옵니다.
   */
  getMessages(): Message[];
  
  /**
   * 저장된 메시지를 지웁니다.
   */
  clear(): void;
}

/**
 * 기본 인메모리 구현
 */
export class SimpleMemory implements Memory {
  private messages: Message[] = [];
  
  /**
   * 최대 저장 메시지 수 (0은 무제한)
   */
  private maxMessages: number;
  
  constructor(options?: { maxMessages?: number }) {
    this.maxMessages = options?.maxMessages || 0;
  }
  
  addMessage(message: Message): void {
    this.messages.push(message);
    
    // 최대 메시지 수 제한 적용
    if (this.maxMessages > 0 && this.messages.length > this.maxMessages) {
      // 시스템 메시지는 항상 유지
      const systemMessages = this.messages.filter(m => m.role === 'system');
      const nonSystemMessages = this.messages.filter(m => m.role !== 'system');
      
      // 비시스템 메시지만 잘라냄
      const remainingCount = this.maxMessages - systemMessages.length;
      const trimmedNonSystemMessages = nonSystemMessages.slice(-remainingCount);
      
      // 시스템 메시지와 잘라낸 비시스템 메시지 합치기
      this.messages = [...systemMessages, ...trimmedNonSystemMessages];
    }
  }
  
  getMessages(): Message[] {
    return this.messages;
  }
  
  clear(): void {
    this.messages = [];
  }
}

/**
 * 시스템 메시지를 유지하는 메모리
 */
export class PersistentSystemMemory implements Memory {
  private memory: SimpleMemory;
  private systemPrompt: string;
  
  constructor(systemPrompt: string, options?: { maxMessages?: number }) {
    this.memory = new SimpleMemory(options);
    this.systemPrompt = systemPrompt;
    
    // 시스템 메시지 추가
    this.memory.addMessage({
      role: 'system',
      content: this.systemPrompt
    });
  }
  
  addMessage(message: Message): void {
    this.memory.addMessage(message);
  }
  
  getMessages(): Message[] {
    return this.memory.getMessages();
  }
  
  clear(): void {
    this.memory.clear();
    
    // 시스템 메시지 다시 추가
    this.memory.addMessage({
      role: 'system',
      content: this.systemPrompt
    });
  }
  
  /**
   * 시스템 프롬프트 업데이트
   */
  updateSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
    
    // 기존 시스템 메시지 제거
    const nonSystemMessages = this.memory.getMessages().filter(m => m.role !== 'system');
    this.memory.clear();
    
    // 새 시스템 메시지 추가
    this.memory.addMessage({
      role: 'system',
      content: this.systemPrompt
    });
    
    // 기존 비시스템 메시지 다시 추가
    for (const message of nonSystemMessages) {
      this.memory.addMessage(message);
    }
  }
} 