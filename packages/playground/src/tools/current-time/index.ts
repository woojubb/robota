import { FunctionTool } from '@robota-sdk/agents';
import type { IPlaygroundToolMeta } from '../types';

// Current Time Tool metadata for UI
export const CURRENT_TIME_META: IPlaygroundToolMeta = {
    id: 'current-time',
    name: 'Current Time',
    description: 'Get current date and time information with timezone support',
    category: 'utility',
    tags: ['time', 'date', 'timezone', 'utility']
};

// Current Time Tool implementation
export function createCurrentTimeTool(): FunctionTool {
    return new FunctionTool(
        {
            name: 'getCurrentTime',
            description: 'Get current date and time information. Can provide time in different formats and timezones.',
            parameters: {
                type: 'object',
                properties: {
                    timezone: {
                        type: 'string',
                        description: 'Timezone identifier (e.g., "Asia/Seoul", "America/New_York", "UTC"). Defaults to local timezone.',
                        default: 'local'
                    },
                    format: {
                        type: 'string',
                        enum: ['iso', 'readable', 'timestamp', 'detailed'],
                        description: 'Output format: "iso" (ISO 8601), "readable" (human readable), "timestamp" (Unix timestamp), "detailed" (comprehensive info)',
                        default: 'readable'
                    },
                    includeWeekday: {
                        type: 'boolean',
                        description: 'Include day of the week in the output',
                        default: true
                    }
                },
                required: []
            }
        },
        async (params) => {
            try {
                const timezoneRaw = params.timezone;
                const formatRaw = params.format;
                const includeWeekdayRaw = params.includeWeekday;

                const timezone =
                    typeof timezoneRaw === 'string' && timezoneRaw.trim().length > 0
                        ? timezoneRaw.trim()
                        : 'local';

                const format =
                    formatRaw === 'iso' || formatRaw === 'readable' || formatRaw === 'timestamp' || formatRaw === 'detailed'
                        ? formatRaw
                        : 'readable';

                const includeWeekday = typeof includeWeekdayRaw === 'boolean' ? includeWeekdayRaw : true;

                // Get current date
                const now = new Date();

                // Handle timezone
                let targetDate: Date;
                let timezoneInfo = '';

                if (timezone === 'local') {
                    targetDate = now;
                    timezoneInfo = Intl.DateTimeFormat().resolvedOptions().timeZone;
                } else {
                    // For other timezones, we'll use toLocaleString with timezone
                    targetDate = now;
                    timezoneInfo = timezone;
                }

                // Format based on requested format
                switch (format) {
                    case 'iso':
                        if (timezone === 'local') {
                            return {
                                success: true,
                                time: targetDate.toISOString(),
                                timezone: timezoneInfo,
                                timestamp: targetDate.getTime()
                            };
                        } else {
                            // For specific timezone, convert to that timezone's ISO representation
                            const timeInTimezone = new Intl.DateTimeFormat('sv-SE', {
                                timeZone: timezone,
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                            }).format(targetDate);

                            return {
                                success: true,
                                time: timeInTimezone.replace(' ', 'T') + 'Z',
                                timezone: timezoneInfo,
                                timestamp: targetDate.getTime()
                            };
                        }

                    case 'timestamp':
                        return {
                            success: true,
                            timestamp: targetDate.getTime(),
                            timezone: timezoneInfo,
                            readable: targetDate.toLocaleString('en-US', {
                                timeZone: timezone === 'local' ? undefined : timezone
                            })
                        };

                    case 'detailed':
                        const detailedOptions: Intl.DateTimeFormatOptions = {
                            timeZone: timezone === 'local' ? undefined : timezone,
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            weekday: 'long',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            timeZoneName: 'long'
                        };

                        return {
                            success: true,
                            detailed: targetDate.toLocaleString('en-US', detailedOptions),
                            iso: targetDate.toISOString(),
                            timestamp: targetDate.getTime(),
                            timezone: timezoneInfo,
                            weekday: targetDate.toLocaleDateString('en-US', {
                                weekday: 'long',
                                timeZone: timezone === 'local' ? undefined : timezone
                            }),
                            date: targetDate.toLocaleDateString('en-US', {
                                timeZone: timezone === 'local' ? undefined : timezone,
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            }),
                            time: targetDate.toLocaleTimeString('en-US', {
                                timeZone: timezone === 'local' ? undefined : timezone,
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                            })
                        };

                    case 'readable':
                    default:
                        const readableOptions: Intl.DateTimeFormatOptions = {
                            timeZone: timezone === 'local' ? undefined : timezone,
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: true
                        };

                        if (includeWeekday) {
                            readableOptions.weekday = 'short';
                        }

                        return {
                            success: true,
                            time: targetDate.toLocaleString('en-US', readableOptions),
                            timezone: timezoneInfo,
                            timestamp: targetDate.getTime(),
                            iso: targetDate.toISOString()
                        };
                }
            } catch (error) {
                return {
                    success: false,
                    error: `Failed to get current time: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    timestamp: Date.now()
                };
            }
        }
    );
}
