import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../cli-args.js';
import {
  driverListenerPort,
  resolveServeObserverOptions,
  SERVE_OBSERVER_TOKEN_MIN_LENGTH,
} from '../serve-observer-args.js';

const TOKEN = 'o'.repeat(SERVE_OBSERVER_TOKEN_MIN_LENGTH);
const OTHER_TOKEN = 'd'.repeat(SERVE_OBSERVER_TOKEN_MIN_LENGTH);
const SERVE_OBSERVER = ['--serve', '--observer-port', '9001'];

describe('--serve observer listener flags', () => {
  it('is off unless --serve names a port, even when the token is set', () => {
    expect(
      resolveServeObserverOptions(parseCliArgs(['--serve']), { PRODUCT_OBSERVER_TOKEN: TOKEN }),
    ).toBeUndefined();
    expect(
      resolveServeObserverOptions(parseCliArgs([]), { PRODUCT_OBSERVER_TOKEN: TOKEN }),
    ).toBeUndefined();
  });

  it('serves the named loopback port with the token from PRODUCT_OBSERVER_TOKEN', () => {
    expect(
      resolveServeObserverOptions(parseCliArgs(SERVE_OBSERVER), {
        PRODUCT_OBSERVER_TOKEN: TOKEN,
      }),
    ).toEqual({ port: 9001, token: TOKEN });
  });

  it('is refused without --serve, because no other mode opens it', () => {
    expect(() =>
      resolveServeObserverOptions(parseCliArgs(['--observer-port', '9001']), {
        PRODUCT_OBSERVER_TOKEN: TOKEN,
      }),
    ).toThrow('--observer-port is only valid with --serve');
  });

  it('refuses to serve without a token, or with one too short to guess-proof', () => {
    const args = parseCliArgs(SERVE_OBSERVER);
    expect(() => resolveServeObserverOptions(args, {})).toThrow(/PRODUCT_OBSERVER_TOKEN/);
    expect(() => resolveServeObserverOptions(args, { PRODUCT_OBSERVER_TOKEN: '' })).toThrow(
      /PRODUCT_OBSERVER_TOKEN/,
    );
    expect(() =>
      resolveServeObserverOptions(args, { PRODUCT_OBSERVER_TOKEN: TOKEN.slice(1) }),
    ).toThrow(new RegExp(`at least ${SERVE_OBSERVER_TOKEN_MIN_LENGTH} characters`));
  });

  it('refuses the driver listener token, which would let an observer drive', () => {
    const args = parseCliArgs(SERVE_OBSERVER);
    expect(() =>
      resolveServeObserverOptions(args, { PRODUCT_OBSERVER_TOKEN: TOKEN }, { driverToken: TOKEN }),
    ).toThrow(/must differ from the driver token and PRODUCT_HTTP_TOKEN/);
    expect(
      resolveServeObserverOptions(
        args,
        { PRODUCT_OBSERVER_TOKEN: TOKEN },
        { driverToken: OTHER_TOKEN },
      ),
    ).toEqual({ port: 9001, token: TOKEN });
  });

  it('refuses the HTTP API bearer, which would let an observer drive', () => {
    const args = parseCliArgs(SERVE_OBSERVER);
    expect(() =>
      resolveServeObserverOptions(args, {
        PRODUCT_OBSERVER_TOKEN: TOKEN,
        PRODUCT_HTTP_TOKEN: TOKEN,
      }),
    ).toThrow(/must differ from the driver token and PRODUCT_HTTP_TOKEN/);
    expect(
      resolveServeObserverOptions(args, {
        PRODUCT_OBSERVER_TOKEN: TOKEN,
        PRODUCT_HTTP_TOKEN: OTHER_TOKEN,
      }),
    ).toEqual({ port: 9001, token: TOKEN });
  });

  it('refuses the port of the HTTP API', () => {
    expect(() =>
      resolveServeObserverOptions(
        parseCliArgs(['--serve', '--http-port', '9001', '--observer-port', '9001']),
        { PRODUCT_OBSERVER_TOKEN: TOKEN },
      ),
    ).toThrow('--observer-port must differ from --http-port and the driver listener port');
    expect(
      resolveServeObserverOptions(
        parseCliArgs(['--serve', '--http-port', '9002', '--observer-port', '9001']),
        { PRODUCT_OBSERVER_TOKEN: TOKEN },
      ),
    ).toEqual({ port: 9001, token: TOKEN });
  });

  it('refuses the port of the driver listener', () => {
    const args = parseCliArgs(SERVE_OBSERVER);
    expect(() =>
      resolveServeObserverOptions(args, { PRODUCT_OBSERVER_TOKEN: TOKEN }, { driverPort: 9001 }),
    ).toThrow('--observer-port must differ from --http-port and the driver listener port');
    expect(
      resolveServeObserverOptions(args, { PRODUCT_OBSERVER_TOKEN: TOKEN }, { driverPort: 9002 }),
    ).toEqual({ port: 9001, token: TOKEN });
  });
});

describe('--observer-port parsing', () => {
  it.each(['0', '70000', '65536', '-1', '1.5', 'abc', ''])(
    'rejects %j as outside 1..65535',
    (value) => {
      // The `=` form, because the argument parser takes a value that starts with a dash for a flag.
      expect(() => parseCliArgs(['--serve', `--observer-port=${value}`])).toThrow(
        '--observer-port must be an integer in 1..65535',
      );
    },
  );

  it.each([1, 9001, 65535])('accepts %i', (port) => {
    expect(parseCliArgs(['--serve', '--observer-port', String(port)]).observerPort).toBe(port);
  });

  it('leaves the port unset without the flag', () => {
    expect(parseCliArgs(['--serve']).observerPort).toBeUndefined();
  });
});

describe('the driver listener port the observer must differ from', () => {
  it('is the port PRODUCT_WS_PORT names', () => {
    expect(driverListenerPort({ PRODUCT_WS_PORT: '7071' })).toBe(7071);
  });

  it('is read the way the listener reads it, so the two compare the same port', () => {
    expect(driverListenerPort({ PRODUCT_WS_PORT: '7071abc' })).toBe(7071);
  });

  it('is unknown when the launcher chose none, or something that is not a number', () => {
    expect(driverListenerPort({})).toBeUndefined();
    expect(driverListenerPort({ PRODUCT_WS_PORT: undefined })).toBeUndefined();
    expect(driverListenerPort({ PRODUCT_WS_PORT: '' })).toBeUndefined();
    expect(driverListenerPort({ PRODUCT_WS_PORT: 'abc' })).toBeUndefined();
  });
});
