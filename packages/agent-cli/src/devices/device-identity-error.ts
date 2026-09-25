/**
 * A device-identity failure the operator may read. Its message names what failed — a file, a key's
 * name, a verdict — and never a value: no phrase, passphrase or key material, and no cause that
 * could quote one.
 */
export class DeviceIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceIdentityError';
  }
}
