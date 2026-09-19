import React from 'react';

import AppPresentation from './AppPresentation.js';
import { useAppController } from './hooks/useAppController.js';
import { ThemeProvider } from './theme/index.js';

import type { IUseAppControllerOptions } from './hooks/useAppController.js';

export type IAppViewProps = IUseAppControllerOptions;

/** Controller boundary: the channel terminates here and only a view model reaches presentation. */
export default function AppView(props: IAppViewProps): React.ReactElement {
  const viewModel = useAppController(props);
  // SCREEN-2002: the provider sits HERE rather than above the controller, because the resolved
  // theme is part of the view model — a provider higher up would have to be fed a theme nobody had
  // resolved yet, and the controller's own hooks read no colours.
  return (
    <ThemeProvider theme={viewModel.theme.resolved} reducedMotion={viewModel.theme.reducedMotion}>
      <AppPresentation viewModel={viewModel} />
    </ThemeProvider>
  );
}
