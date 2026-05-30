import { MonitorClient } from './MonitorClient';

import type { Metadata } from 'next';
import type { ReactElement } from 'react';

export const metadata: Metadata = {
  title: 'CLI Monitor — Robota',
};

export default function MonitorPage(): ReactElement {
  return <MonitorClient />;
}
