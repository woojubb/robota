/** Product-owned paths the Robota shell permits for ordinary context discovery. */
export const ROBOTA_PERMISSION_BASELINE: readonly string[] = [
  'Read(.agents/**)',
  'Read(.claude/**)',
  'Read(.robota/**)',
  'Glob(.agents/**)',
  'Glob(.claude/**)',
  'Glob(.robota/**)',
];
