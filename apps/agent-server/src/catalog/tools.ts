export interface IToolCatalogEntry {
  id: string;
  name: string;
  description: string;
  inputSchema: object;
  category: string;
}

export interface IToolCatalogResponse {
  tools: IToolCatalogEntry[];
}

export interface IServerToolEntry extends IToolCatalogEntry {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

function executeCurrentTime(params: Record<string, unknown>): Promise<unknown> {
  try {
    const timezoneRaw = params['timezone'];
    const formatRaw = params['format'];
    const includeWeekdayRaw = params['includeWeekday'];

    const timezone =
      typeof timezoneRaw === 'string' && timezoneRaw.trim().length > 0
        ? timezoneRaw.trim()
        : 'local';

    const format =
      formatRaw === 'iso' ||
      formatRaw === 'readable' ||
      formatRaw === 'timestamp' ||
      formatRaw === 'detailed'
        ? formatRaw
        : 'readable';

    const includeWeekday = typeof includeWeekdayRaw === 'boolean' ? includeWeekdayRaw : true;
    const now = new Date();
    const timezoneInfo =
      timezone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : timezone;

    switch (format) {
      case 'iso': {
        if (timezone === 'local') {
          return Promise.resolve({
            success: true,
            time: now.toISOString(),
            timezone: timezoneInfo,
            timestamp: now.getTime(),
          });
        }
        const isoStr = new Intl.DateTimeFormat('sv-SE', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(now);
        return Promise.resolve({
          success: true,
          time: isoStr.replace(' ', 'T') + 'Z',
          timezone: timezoneInfo,
          timestamp: now.getTime(),
        });
      }
      case 'timestamp':
        return Promise.resolve({
          success: true,
          timestamp: now.getTime(),
          timezone: timezoneInfo,
          readable: now.toLocaleString('en-US', {
            timeZone: timezone === 'local' ? undefined : timezone,
          }),
        });
      case 'detailed':
        return Promise.resolve({
          success: true,
          detailed: now.toLocaleString('en-US', {
            timeZone: timezone === 'local' ? undefined : timezone,
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'long',
          }),
          iso: now.toISOString(),
          timestamp: now.getTime(),
          timezone: timezoneInfo,
        });
      default: {
        const opts: Intl.DateTimeFormatOptions = {
          timeZone: timezone === 'local' ? undefined : timezone,
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        };
        if (includeWeekday) opts.weekday = 'short';
        return Promise.resolve({
          success: true,
          time: now.toLocaleString('en-US', opts),
          timezone: timezoneInfo,
          timestamp: now.getTime(),
          iso: now.toISOString(),
        });
      }
    }
  } catch (error) {
    return Promise.resolve({
      success: false,
      error: `Failed to get current time: ${error instanceof Error ? error.message : 'Unknown error'}`,
      timestamp: Date.now(),
    });
  }
}

const TOOL_REGISTRY = new Map<string, IServerToolEntry>([
  [
    'current-time',
    {
      id: 'current-time',
      name: 'Current Time',
      description: 'Get current date and time information with timezone support',
      category: 'utility',
      inputSchema: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Timezone identifier (e.g., "Asia/Seoul", "UTC"). Defaults to local.',
            default: 'local',
          },
          format: {
            type: 'string',
            enum: ['iso', 'readable', 'timestamp', 'detailed'],
            description: 'Output format. Defaults to "readable".',
            default: 'readable',
          },
          includeWeekday: {
            type: 'boolean',
            description: 'Include day of the week in the output',
            default: true,
          },
        },
        required: [],
      },
      execute: (input) => executeCurrentTime(input),
    },
  ],
]);

export function getToolRegistry(): Map<string, IServerToolEntry> {
  return TOOL_REGISTRY;
}

export function getToolCatalog(): IToolCatalogResponse {
  const tools: IToolCatalogEntry[] = Array.from(TOOL_REGISTRY.values()).map(
    ({ execute: _execute, ...entry }) => entry,
  );
  return { tools };
}
