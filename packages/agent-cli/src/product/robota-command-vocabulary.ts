import type { IDoctorDisplayVocabulary } from '@robota-sdk/agent-command';

export const ROBOTA_EDITOR_TEMPORARY_DIRECTORY_PREFIX = 'robota-editor-';

/** The CLI owns the product words shown by neutral diagnostic and session commands. */
export const ROBOTA_DOCTOR_DISPLAY: IDoctorDisplayVocabulary = {
  title: 'robota doctor',
  productName: 'robota',
  formatRepairCommand: (checkId) => `robota doctor --repair ${checkId}`,
  repairOffer: 'run with --repair <check-id> (asks before writing; --yes skips the prompt)',
};

export const ROBOTA_DOCTOR_SLASH_DISPLAY: IDoctorDisplayVocabulary = {
  ...ROBOTA_DOCTOR_DISPLAY,
  formatRepairCommand: (checkId) => `/doctor repair ${checkId}`,
  repairOffer: 'use /doctor repair <check-id> (asks before writing)',
};

export function formatRobotaResumeCommand(sessionId: string): string {
  return `robota --resume ${sessionId}`;
}
