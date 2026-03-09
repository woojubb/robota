/**
 * Shared Types Tests
 *
 * Tests for enum values and type re-exports from the shared types module.
 */

import { describe, it, expect } from 'vitest';
import { CommunicationProtocol } from '../types';

describe('Shared Types', () => {
    describe('CommunicationProtocol', () => {
        it('should define HTTP_REST protocol', () => {
            expect(CommunicationProtocol.HTTP_REST).toBe('http-rest');
        });

        it('should define WEBSOCKET protocol', () => {
            expect(CommunicationProtocol.WEBSOCKET).toBe('websocket');
        });

        it('should define GRPC protocol', () => {
            expect(CommunicationProtocol.GRPC).toBe('grpc');
        });
    });
});
