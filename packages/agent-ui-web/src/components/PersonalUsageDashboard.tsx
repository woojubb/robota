import { useEffect, useState } from 'react';

import {
  CurrentSessionPanel,
  PersonalUsageContent,
  UsageHeader,
} from './PersonalUsageDashboardSections.js';

import type {
  TPersonalUsageDashboardState,
  TUsageBreakdown,
} from './personal-usage-dashboard-types.js';

export function PersonalUsageDashboard({
  state,
}: {
  state: TPersonalUsageDashboardState;
}): React.ReactElement {
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [breakdown, setBreakdown] = useState<TUsageBreakdown>('model');

  useEffect(() => {
    state.requestPersonalUsage(period);
  }, [period, state.requestPersonalUsage]);

  return (
    <main className="gui-rise h-full overflow-y-auto p-5 md:p-7" aria-label="Personal usage">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <UsageHeader
          period={period}
          setPeriod={setPeriod}
          requestCurrentSessionUsage={state.requestCurrentSessionUsage}
        />
        <CurrentSessionPanel state={state} />
        <PersonalUsageContent state={state} breakdown={breakdown} setBreakdown={setBreakdown} />
      </div>
    </main>
  );
}
