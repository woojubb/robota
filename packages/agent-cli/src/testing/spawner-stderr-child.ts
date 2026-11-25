import { answerHandedOverSpawnerPair } from '@robota-sdk/agent-local-host';

answerHandedOverSpawnerPair();
process.stderr.write(`startup failure: ${process.env.REFERENCE_ONLY} ${process.env.REFERENCE_SHORT}\n`, () => { process.exitCode = 1; });
