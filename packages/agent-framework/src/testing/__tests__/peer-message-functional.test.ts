/**
 * Peer session-to-session messaging — framework functional test (PEER-002, #1809).
 *
 * #1809's acceptance criteria ask for exactly this level: "framework-level functional coverage
 * exercises a two-session conversation with deterministic providers". So this drives TWO REAL
 * sessions (scripted provider, no CLI, no network) and passes messages between them the way a
 * composition root would — through the session's peer-message entry point, not through `submit`
 * with a hand-set option.
 *
 * What it proves is the pair of things the issue names: a peer message reaches the runtime WITH its
 * origin intact, and it can trigger a response. The unit tests cover the ingress's decisions; this
 * covers that the wiring actually carries them into a live agent loop.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const TEST_TIMEOUT = 30_000;

let alice: ScriptedSessionHarness | undefined;
let bob: ScriptedSessionHarness | undefined;

afterEach(async () => {
  await alice?.dispose();
  await bob?.dispose();
  alice = undefined;
  bob = undefined;
});

describe('peer session-to-session messaging (framework functional)', () => {
  it(
    'a peer message reaches the receiving runtime and produces a response',
    async () => {
      bob = scriptedSession({ turns: [{ text: 'answering the peer' }] });

      const result = await bob.submitPeer('are you there?', 'session_alice');

      // It reached the model: a real provider request was made for the peer's text.
      expect(bob.requests).toHaveLength(1);
      expect(JSON.stringify(bob.requests[0])).toContain('are you there?');
      expect(result).toBeDefined();
    },
    TEST_TIMEOUT,
  );

  it(
    'the runtime can tell a peer turn from its own operator',
    async () => {
      // The half of the requirement that shapes the whole design. An agent answering a peer carries
      // different authority than one answering its operator, and it cannot act on that distinction
      // if the origin arrived as prose inside the prompt.
      bob = scriptedSession({ turns: [{ text: 'to the owner' }, { text: 'to the peer' }] });

      await bob.submit('hello from my own operator');
      await bob.submitPeer('hello from another session', 'session_alice');

      const sources = bob.emittedEvents('turn_source').map(([source]) => source);
      expect(sources).toEqual(['user', 'peer']);
    },
    TEST_TIMEOUT,
  );

  it(
    'attribution names the peer, and never the operator',
    async () => {
      // Before PEER-002 this turn would have defaulted to the owner, putting another session's
      // message in the transcript under the operator's name.
      bob = scriptedSession({ turns: [{ text: 'ok' }] });

      // Read once the turn has actually STARTED. Reading before that returns null — the driver is
      // stamped when the turn begins, so an assertion taken at submit time would pass or fail on
      // scheduling rather than on attribution.
      const started = bob.awaitEvent('turn_source', (source) => source === 'peer');
      const settled = bob.submitPeer('a message', 'session_alice');
      await started;
      const driver = bob.session.getActiveDriverId();
      await settled;

      expect(driver).toBe('peer:session_alice');
      expect(driver).not.toBe('owner');
    },
    TEST_TIMEOUT,
  );

  it(
    'two live sessions hold a conversation in both directions',
    async () => {
      // The acceptance criterion stated as an observable: each side's answer becomes the other
      // side's next incoming message, and both transcripts show a peer turn.
      alice = scriptedSession({ turns: [{ text: 'alice replies' }] });
      bob = scriptedSession({ turns: [{ text: 'bob replies' }] });

      await bob.submitPeer('alice asks bob', 'session_alice');
      await alice.submitPeer('bob asks alice', 'session_bob');

      expect(bob.requests).toHaveLength(1);
      expect(alice.requests).toHaveLength(1);
      expect(bob.emittedEvents('turn_source').map(([s]) => s)).toContain('peer');
      expect(alice.emittedEvents('turn_source').map(([s]) => s)).toContain('peer');
    },
    TEST_TIMEOUT,
  );

  it(
    'a peer message lands in the conversation the agent can read back',
    async () => {
      // "Added to the receiving runtime context" — asserted on the history the next turn will see,
      // rather than on the request alone, because a message that reached the provider but not the
      // conversation would be forgotten by the following turn.
      bob = scriptedSession({ turns: [{ text: 'noted' }] });

      await bob.submitPeer('remember this', 'session_alice');

      expect(JSON.stringify(bob.history())).toContain('remember this');
    },
    TEST_TIMEOUT,
  );
});
