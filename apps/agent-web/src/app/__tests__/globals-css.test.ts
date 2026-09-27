/**
 * The /remote page renders the GUI surface (agent-ui-web, through agent-transport-webrtc-web's
 * RemoteClient). Tailwind generates only the classes it scans, and the surface's tokens exist only if its
 * scoped styles are imported into this app's Tailwind entry.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const entry = readFileSync(path.join(__dirname, '..', 'globals.css'), 'utf8');

describe('the Tailwind entry', () => {
  it('imports the surface styles scoped to .robota-ui, not the whole-page theme', () => {
    expect(entry).toContain("@import '@robota-sdk/agent-ui-web/styles/surface.css';");
    expect(entry).not.toContain('agent-ui-web/styles/theme.css');
  });

  it('scans the sources that render the surface', () => {
    expect(entry).toContain('@source "../../../../packages/agent-ui-web/src";');
    expect(entry).toContain('@source "../../../../packages/agent-transport-webrtc-web/src";');
  });
});
