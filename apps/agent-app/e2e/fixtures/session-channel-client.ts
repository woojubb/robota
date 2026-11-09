import { createDesktopSessionClient } from '@robota-sdk/agent-ui-web';

window.fixtureMessages = [];
window.fixtureStatus = 'waiting';
const client = createDesktopSessionClient(window.desktopSession, {
  onMessage: (message) => window.fixtureMessages.push(message),
  onStatusChange: (status) => {
    window.fixtureStatus = status;
  },
});
window.fixtureStart = () => client.connect();
window.fixtureSend = () => client.send({ type: 'get-messages' });
