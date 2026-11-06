/**
 * How many descriptors this process holds open, for a test that must show a connection was let go of
 * and not only answered. Counted the same way before and after, so the descriptor the listing itself
 * opens cancels out.
 */
import { readdirSync } from 'node:fs';

export function openDescriptorCount(): number {
  return readdirSync(process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd').length;
}
