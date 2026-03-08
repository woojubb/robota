import type { IClockPort } from '../interfaces/ports.js';
import type { TDagTriggerType } from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import { buildValidationError } from '../utils/error-builders.js';

/** Resolved time context for a DAG run: trigger type, logical date, and request timestamp. */
export interface IResolvedTimeSemantics {
    trigger: TDagTriggerType;
    logicalDate: string;
    requestedAt: string;
}

function parseToUtcIso(value: string): TResult<string, IDagError> {
    const epochMs = Date.parse(value);
    if (Number.isNaN(epochMs)) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_INVALID_LOGICAL_DATE',
                'logicalDate must be a valid ISO-8601 datetime string',
                { logicalDate: value }
            )
        };
    }

    return {
        ok: true,
        value: new Date(epochMs).toISOString()
    };
}

/** Resolves trigger type and logical date into a normalized time context for a DAG run. */
export class TimeSemanticsService {
    public constructor(private readonly clock: IClockPort) {}

    public resolve(trigger: TDagTriggerType, logicalDate?: string): TResult<IResolvedTimeSemantics, IDagError> {
        const requestedAt = this.clock.nowIso();

        if (trigger === 'scheduled') {
            if (!logicalDate) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_MISSING_LOGICAL_DATE',
                        'scheduled trigger requires logicalDate',
                        { trigger }
                    )
                };
            }

            const parsed = parseToUtcIso(logicalDate);
            if (!parsed.ok) {
                return parsed;
            }

            return {
                ok: true,
                value: {
                    trigger,
                    logicalDate: parsed.value,
                    requestedAt
                }
            };
        }

        if (!logicalDate) {
            return {
                ok: true,
                value: {
                    trigger,
                    logicalDate: requestedAt,
                    requestedAt
                }
            };
        }

        const parsed = parseToUtcIso(logicalDate);
        if (!parsed.ok) {
            return parsed;
        }

        return {
            ok: true,
            value: {
                trigger,
                logicalDate: parsed.value,
                requestedAt
            }
        };
    }
}
