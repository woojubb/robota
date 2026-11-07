import { answerHandedOverSpawnerPair } from '../session-inventory/supervised-spawner-pair.js';

answerHandedOverSpawnerPair();
process.stderr.write(`startup failure: ${process.env.REFERENCE_ONLY} ${process.env.REFERENCE_SHORT}\n`, () => { process.exitCode = 1; });
