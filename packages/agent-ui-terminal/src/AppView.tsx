import React from 'react';

import AppPresentation from './AppPresentation.js';
import { useAppController } from './hooks/useAppController.js';

import type { IUseAppControllerOptions } from './hooks/useAppController.js';

export type IAppViewProps = IUseAppControllerOptions;

/** Controller boundary: the channel terminates here and only a view model reaches presentation. */
export default function AppView(props: IAppViewProps): React.ReactElement {
  const viewModel = useAppController(props);
  return <AppPresentation viewModel={viewModel} />;
}
