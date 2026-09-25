/**
 * Which provider and model a run's request is actually on.
 *
 * A provider that can answer on another model decides the move itself; this only keeps the loop's
 * records honest about it. Without such a provider the route stays empty and every record keeps
 * naming the configured provider and model, exactly as before.
 */

import type { IResolvedProviderInfo } from './execution-types';
import type { IModelFallbackNotice } from '../interfaces/model-fallback';
import type { IModelRef } from '../interfaces/role-model';

export interface IModelRoute {
  /** Where the request is now; absent while it is on the configured provider and model. */
  current?: IModelRef;
}

/** Ask the provider where this run's request for `model` goes first. */
export function openModelRoute(
  resolved: IResolvedProviderInfo,
  model: string,
  executionId: string,
): IModelRoute {
  const first = resolved.provider.resolveModelRoute?.(model, executionId);
  if (first === undefined) return {};
  if (first.provider === resolved.currentInfo.provider && first.model === model) return {};
  return { current: first };
}

/** The provider the request is on, falling back to the configured one. */
export function routeProvider(route: IModelRoute, resolved: IResolvedProviderInfo): string {
  return route.current?.provider ?? resolved.currentInfo.provider;
}

/** The model the request is on, falling back to `configured`. */
export function routeModel(route: IModelRoute, configured: string): string {
  return route.current?.model ?? configured;
}

/** Record a move the provider reported. */
export function moveModelRoute(route: IModelRoute, notice: IModelFallbackNotice): void {
  route.current = { provider: notice.to.provider, model: notice.to.model };
}
