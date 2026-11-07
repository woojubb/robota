/**
 * The one liveness rule both process-scoped directories and process markers judge an owner by, with
 * every probe injected so each branch is reached without real pids, boots or namespaces.
 */

import { describe, expect, it } from 'vitest';

import { classifyProcessOwner } from './process-owner-record.js';

import type { IProcessIdentity } from '../interfaces/process-marker.js';

const HERE: IProcessIdentity = {
  pid: 5000,
  startTime: 'started-5000',
  bootId: 'boot-a',
  pidNamespace: 'pid:[4026531836]',
  hostname: 'host-a',
  machineId: 'machine-a',
};

const OTHER: IProcessIdentity = { ...HERE, pid: 6000, startTime: 'started-6000' };

/** Probes for a world where `alive` pids run with the start times `starts` gives. */
function probes(alive: readonly number[], starts: Readonly<Record<number, string>> = {}) {
  return {
    current: HERE,
    isProcessAlive: (pid: number) => alive.includes(pid),
    readStartTime: (pid: number) => starts[pid],
  };
}

describe('classifyProcessOwner', () => {
  it('is alive for a running pid with the start time the record carries', () => {
    expect(classifyProcessOwner(OTHER, probes([6000], { 6000: 'started-6000' }))).toBe('alive');
  });

  it('is gone for a pid that no longer runs', () => {
    expect(classifyProcessOwner(OTHER, probes([]))).toBe('gone');
  });

  it('is gone for a pid reused by a process with another start time', () => {
    expect(classifyProcessOwner(OTHER, probes([6000], { 6000: 'started-later' }))).toBe('gone');
  });

  it('is gone for an owner from an earlier boot of this machine', () => {
    expect(classifyProcessOwner({ ...OTHER, bootId: 'boot-0' }, probes([6000]))).toBe('gone');
  });

  it('is unknown for an owner on another machine, even with a dead pid here', () => {
    expect(classifyProcessOwner({ ...OTHER, machineId: 'machine-b' }, probes([]))).toBe('unknown');
    const { hostname: _ignored, ...nameless } = OTHER;
    expect(classifyProcessOwner(nameless, probes([]))).toBe('unknown');
  });

  it('is unknown for an owner in another pid namespace', () => {
    expect(classifyProcessOwner({ ...OTHER, pidNamespace: 'pid:[1]' }, probes([]))).toBe('unknown');
  });

  it('is unknown for a running pid whose start time is not recorded or not readable', () => {
    const { startTime: _ignored, ...unrecorded } = OTHER;
    expect(classifyProcessOwner(unrecorded, probes([6000], { 6000: 'started-6000' }))).toBe(
      'unknown',
    );
    expect(classifyProcessOwner(OTHER, probes([6000]))).toBe('unknown');
  });

  it('judges this process by its own start time, never by a signal probe', () => {
    const never = { ...probes([]), isProcessAlive: () => false };
    expect(classifyProcessOwner(HERE, never)).toBe('alive');
    expect(classifyProcessOwner({ ...HERE, startTime: 'started-earlier' }, never)).toBe('gone');
  });

  it('on a platform with no start time, a live owner (this process too) is unknown and a dead one gone', () => {
    const { startTime: _a, bootId: _b, pidNamespace: _c, machineId: _d, ...windows } = HERE;
    const world = { current: windows, isProcessAlive: (pid: number) => pid === 6000 };
    expect(classifyProcessOwner({ ...windows, pid: 6000 }, world)).toBe('unknown');
    expect(classifyProcessOwner(windows, world)).toBe('unknown');
    expect(classifyProcessOwner({ ...windows, pid: 7000 }, world)).toBe('gone');
  });

  it('is unknown when a probe throws', () => {
    const broken = {
      ...probes([6000]),
      readStartTime: () => {
        throw new Error('probe failed');
      },
    };
    expect(classifyProcessOwner(OTHER, broken)).toBe('unknown');
  });
});
