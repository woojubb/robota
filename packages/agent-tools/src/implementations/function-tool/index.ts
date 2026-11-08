/**
 * FunctionTool - Centralized exports for Facade pattern
 *
 * This module provides a clean interface for function tool functionality
 * with proper separation of concerns and type safety.
 *
 * Zod compatibility types and schema conversion utilities moved to
 * @robota-sdk/agent-core (CORE-015 SSOT) — import them from core.
 */

// Core types
export type {
  IFunctionToolValidationOptions,
  IFunctionToolExecutionMetadata,
  IFunctionToolResult,
} from './types';
