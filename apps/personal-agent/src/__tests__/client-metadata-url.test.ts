import { describe, expect, it } from 'vitest';

import {
  CLIENT_METADATA_URL_VARIABLE,
  clientMetadataUrlFrom,
} from '../connectors/client-metadata-url.js';

const URL_OK = 'https://client.example.test/clients/agent.json';

describe('the client metadata address setting', () => {
  it('is absent when unset or blank, and is the trimmed address when it can name a client', () => {
    expect(clientMetadataUrlFrom({})).toBeUndefined();
    expect(clientMetadataUrlFrom({ [CLIENT_METADATA_URL_VARIABLE]: '   ' })).toBeUndefined();
    expect(clientMetadataUrlFrom({ [CLIENT_METADATA_URL_VARIABLE]: ` ${URL_OK} ` })).toBe(URL_OK);
  });

  it.each([
    ['not https', 'http://client.example.test/clients/agent.json'],
    ['without a path', 'https://client.example.test/'],
    ['not an address', 'agent.json'],
    ['carrying a user name and password', 'https://u:p@client.example.test/clients/agent.json'],
    ['carrying a fragment', 'https://client.example.test/clients/agent.json#x'],
  ])('refuses an address that is %s, so the agent never starts with it', (_name, value) => {
    expect(() => clientMetadataUrlFrom({ [CLIENT_METADATA_URL_VARIABLE]: value })).toThrow(
      /must be an https address with a path/u,
    );
  });
});
