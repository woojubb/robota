import type { Metadata } from 'next';
import { MonitorClient } from './MonitorClient';

export const metadata: Metadata = {
  title: 'CLI Monitor — Robota',
};

export default function MonitorPage() {
  return <MonitorClient />;
}
