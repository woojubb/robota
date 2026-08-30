export function createWorkRunMeasurementScan(commandPath) {
  return {
    name: 'work-run-measurement',
    command: ['node', commandPath],
    always: true,
  };
}
