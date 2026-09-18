/**
 * The doctor runner (OBSERVABILITY-1991): one pass over every probe, one redaction boundary, one
 * exit-code aggregation. Reachable without a session — it constructs no provider, no preset and no
 * session; the host supplies what it composed and the checks only it can make.
 */
import { probeExtensions } from './doctor-extensions-probe.js';
import { collectSettingsSecrets, redactDiagnosticText } from './doctor-redaction.js';
import { probeProvider, probeSettings } from './doctor-settings-probe.js';
import { probeStorageAndTrust } from './doctor-storage-probe.js';

import type { ISettingsProbeResult } from './doctor-settings-probe.js';
import type { IDoctorCheck, IDoctorDeps, IDoctorInputs, IDoctorReport } from './doctor-types.js';

/** A probe that throws is a `fail` check carrying the owner's error class — never a default value. */
function probeFailure(id: string, label: string, error: Error): IDoctorCheck {
  return { id, label, status: 'fail', cause: `${error.name}: ${error.message}` };
}

async function guarded<T>(
  id: string,
  label: string,
  probe: () => Promise<T> | T,
  onValue: (value: T) => readonly IDoctorCheck[],
): Promise<readonly IDoctorCheck[]> {
  try {
    return onValue(await probe());
  } catch (error) {
    // allow-fallback: the probe's own failure is reported as a check, per the fallback declaration
    return [probeFailure(id, label, error instanceof Error ? error : new Error(String(error)))];
  }
}

function redactCheck(check: IDoctorCheck, secrets: readonly string[]): IDoctorCheck {
  const redact = (text: string): string => redactDiagnosticText(text, secrets);
  return {
    ...check,
    label: redact(check.label),
    ...(check.path === undefined ? {} : { path: redact(check.path) }),
    ...(check.cause === undefined ? {} : { cause: redact(check.cause) }),
    ...(check.detail === undefined ? {} : { detail: check.detail.map(redact) }),
  };
}

/** Aggregate checks into the report; `fail` alone raises the exit code (CLI-067). */
export function buildDoctorReport(checks: readonly IDoctorCheck[]): IDoctorReport {
  const failCount = checks.filter((check) => check.status === 'fail').length;
  const warnCount = checks.filter((check) => check.status === 'warn').length;
  return {
    checks,
    failCount,
    warnCount,
    repairable: checks.flatMap((check) => (check.repair === undefined ? [] : [check.repair])),
    exitCode: failCount === 0 ? 0 : 1,
  };
}

/** The settings probe under its own boundary: its failure is a `fail` check and later probes run without layers. */
function guardedSettings(inputs: IDoctorInputs): {
  checks: readonly IDoctorCheck[];
  result?: ISettingsProbeResult;
} {
  try {
    const result = probeSettings(inputs);
    return { checks: result.checks, result };
  } catch (error) {
    // allow-fallback: the settings probe's own failure is a `fail` check; later probes run without layers
    const cause = error instanceof Error ? error : new Error(String(error));
    return { checks: [probeFailure('settings', 'Settings', cause)] };
  }
}

/** Run every probe and return the redacted report. */
export async function runDoctor(inputs: IDoctorInputs, deps: IDoctorDeps): Promise<IDoctorReport> {
  const checks: IDoctorCheck[] = [...inputs.hostChecks];
  if (inputs.compositionFailure !== undefined) checks.push(inputs.compositionFailure);

  const settings = guardedSettings(inputs);
  checks.push(...settings.checks);
  const inspection = settings.result?.inspection;

  const secrets = collectSettingsSecrets(
    (inspection?.layers ?? []).map((layer) => layer.settings),
    inputs.env,
  );

  checks.push(
    ...(await guarded(
      'provider',
      'Provider',
      () => probeProvider(inputs, deps),
      (provider) => {
        if (provider.resolvedApiKey !== undefined) secrets.push(provider.resolvedApiKey);
        return provider.checks;
      },
    )),
  );

  if (inspection !== undefined) {
    checks.push(
      ...(await guarded(
        'storage',
        'Storage',
        () => probeStorageAndTrust(inputs, deps, inspection),
        (c) => c,
      )),
    );
    checks.push(
      ...(await guarded(
        'extensions',
        'Extensions',
        () => probeExtensions(inputs, deps, inspection),
        (c) => c,
      )),
    );
  }

  return buildDoctorReport(checks.map((check) => redactCheck(check, secrets)));
}
