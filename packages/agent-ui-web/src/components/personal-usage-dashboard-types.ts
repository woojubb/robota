import type { IWsSessionState } from '../hooks/useSessionClient.js';

export type TUsageBreakdown = 'model' | 'provider' | 'surface' | 'source' | 'activity';

export type TPersonalUsageDashboardState = Pick<
  IWsSessionState,
  | 'personalUsageStatus'
  | 'personalUsageReport'
  | 'personalUsageError'
  | 'requestPersonalUsage'
  | 'storedSessionUsageStatus'
  | 'storedSessionUsageReport'
  | 'storedSessionUsageSessionId'
  | 'storedSessionUsageError'
  | 'requestStoredSessionUsage'
  | 'currentSessionUsageStatus'
  | 'currentSessionUsageReport'
  | 'requestCurrentSessionUsage'
  // The dashboard names a session from this workspace's own local listing (see `sessionTitle()` in
  // `SessionSidebar.tsx`) instead of any content carried in the report itself.
  | 'sessionListing'
>;

export type TPersonalUsageReport = NonNullable<TPersonalUsageDashboardState['personalUsageReport']>;

export type TPersonalUsageDimension = TPersonalUsageReport['byModel'][number];
