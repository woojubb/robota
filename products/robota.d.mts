export function robotaEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  home: string,
  acceptsProfile?: (environment: Readonly<Record<string, string | undefined>>) => boolean,
): Readonly<Record<string, string | undefined>>;
