// The build replaces this source bridge with the shared policy transpiled to the app's module format.
import { createRequire } from 'node:module';

type TEnvironment = Readonly<Record<string, string | undefined>>;
export const robotaEnvironment: (
  environment: TEnvironment,
  home: string,
  acceptsProfile?: (environment: TEnvironment) => boolean,
) => TEnvironment = createRequire(__filename)('../../../products/robota.mjs').robotaEnvironment;
