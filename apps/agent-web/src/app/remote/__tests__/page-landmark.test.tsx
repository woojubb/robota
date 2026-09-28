/**
 * #3289 §3 review — /remote renders exactly one `main` landmark in every state, including while its
 * client bundle is still loading. `next/dynamic`'s `loading` fallback (shown before `RemoteClient`
 * itself mounts and supplies its own `main`, per `agent-transport-webrtc-web`'s own fix for this) is a
 * plain function passed to `dynamic()`, not an exported component — mocking `next/dynamic` to hand
 * that function straight back lets this test render exactly what a person sees while it loads.
 */

import { render } from '@testing-library/react';

interface IDynamicOptions {
  loading: () => React.ReactElement;
}

jest.mock('next/dynamic', () => (_loader: unknown, options: IDynamicOptions) => options.loading);

// eslint-disable-next-line import/first -- must follow the mock above, which next/dynamic needs hoisted
import RemotePage from '../page';

describe('/remote renders exactly one main landmark (#3289 §3 review)', () => {
  it('while the remote client bundle is still loading', () => {
    const { container } = render(<RemotePage />);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});
