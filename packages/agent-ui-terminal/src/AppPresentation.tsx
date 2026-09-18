import { Box, Static } from 'ink';
import React from 'react';

import { AppBanner } from './app-banner.js';
import BackgroundTaskPanel from './BackgroundTaskPanel.js';
import { ContextWarningBanner } from './ContextWarningBanner.js';
import ExecutionWorkspaceDetailPane from './ExecutionWorkspaceDetailPane.js';
import ExecutionWorkspaceSwitcher from './ExecutionWorkspaceSwitcher.js';
import InputArea from './InputArea.js';
import { useKeybindings } from './keybindings/keybindings-context.js';
import { EntryItem } from './MessageList.js';
import PendingActionPrompt from './PendingActionPrompt.js';
import PermissionPrompt from './PermissionPrompt.js';
import PluginTUI from './PluginTUI.js';
import { Text } from './SafeText.js';
import SessionEventNotices from './SessionEventNotices.js';
import SessionPicker from './SessionPicker.js';
import SessionStatusBar from './SessionStatusBar.js';
import StreamingIndicator from './StreamingIndicator.js';
import TransportTUI from './TransportTUI.js';
import { PALETTE } from './tui-palette.js';
import UpdateNotice from './UpdateNotice.js';

import type { IAppViewModel } from './app-view-model.js';

function Transcript({ model }: { model: IAppViewModel }): React.ReactElement {
  return (
    <Static items={model.staticItems}>
      {(item) =>
        item.kind === 'banner' ? (
          <AppBanner key="logo" version={item.version} />
        ) : (
          <EntryItem key={item.entry.id} entry={item.entry} />
        )
      }
    </Static>
  );
}

function Activity({ model }: { model: IAppViewModel }): React.ReactElement {
  const { background, stream } = model;
  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {background.selectedEntry && background.selectedEntry.kind !== 'main_thread' && (
        <ExecutionWorkspaceDetailPane
          entry={background.selectedEntry}
          page={background.detail.page}
          loading={background.detail.loading}
          error={background.detail.error}
        />
      )}
      {model.isShuttingDown && <Text color={PALETTE.text.warning}>Shutting down...</Text>}
      {(stream.isThinking || stream.activeTools.length > 0) && (
        <Box flexDirection="column" marginBottom={1}>
          <StreamingIndicator
            text={stream.text}
            activeTools={stream.activeTools}
            isThinking={stream.isThinking}
          />
          {stream.isStalled && (
            <Text color={PALETTE.text.warning}>
              ⚠ Still waiting on the provider — the network may be stalled. Esc to interrupt.
            </Text>
          )}
        </Box>
      )}
      {!stream.isThinking && stream.lastErrorMessage && (
        <Text color={PALETTE.text.error}>
          ✖ Last turn failed — the session is alive; type your next prompt when ready.
        </Text>
      )}
      <BackgroundTaskPanel entries={background.entries} focusedIndex={background.focusedIndex} />
    </Box>
  );
}

function Overlays({ model }: { model: IAppViewModel }): React.ReactElement {
  if (model.coordinationError !== undefined || model.coordinationPending) return <></>;
  const { background, plugin, sessionPicker, transport } = model;
  const pendingUserAction = model.pendingUserAction;
  return (
    <>
      {background.switcherVisible && (
        <ExecutionWorkspaceSwitcher
          snapshot={background.snapshot}
          selectedEntryId={background.selectedEntryId}
          onSelect={background.select}
          onClose={background.closeSwitcher}
          onAttach={background.attachToFork}
        />
      )}
      {model.permissionRequest && <PermissionPrompt request={model.permissionRequest} />}
      {pendingUserAction && (
        <PendingActionPrompt
          request={pendingUserAction}
          onAnswer={(response) => model.resolveUserAction(pendingUserAction, response)}
        />
      )}
      {plugin.visible && (
        <PluginTUI
          callbacks={plugin.callbacks}
          onClose={plugin.close}
          addMessage={(message) => plugin.addMessage(message.content)}
        />
      )}
      {transport.visible && transport.registry && (
        <TransportTUI registry={transport.registry} onClose={transport.close} />
      )}
      {sessionPicker.visible && (
        <SessionPicker
          sessions={sessionPicker.sessions}
          onSelect={sessionPicker.select}
          onCancel={sessionPicker.cancel}
        />
      )}
    </>
  );
}

function PromptAndStatus({ model }: { model: IAppViewModel }): React.ReactElement {
  const { input } = model;
  return (
    <>
      <ContextWarningBanner percentage={model.contextPercentage} />
      <InputArea
        onSubmit={input.submit}
        onCancelQueue={input.cancelQueue}
        isDisabled={input.disabled}
        isQueueCancellationDisabled={input.queueCancellationDisabled}
        isAborting={input.isAborting}
        pendingPrompt={input.pendingPrompt}
        pendingCount={input.pendingCount}
        commandQueryPort={input.commandQueryPort}
        sessionName={input.sessionName}
        history={input.history}
        onRequestFocusBackgroundList={input.focusBackgroundList}
      />
      <SessionStatusBar {...model.status} />
    </>
  );
}

/** Pure presentation tree: it receives no channel, session, registry, or mutable state manager. */
export default function AppPresentation({
  viewModel,
}: {
  viewModel: IAppViewModel;
}): React.ReactElement {
  const keybindings = useKeybindings();
  return (
    <Box flexDirection="column">
      <Transcript model={viewModel} />
      {viewModel.updateNotice && <UpdateNotice message={viewModel.updateNotice} />}
      {viewModel.coordinationError && (
        <Text color={PALETTE.text.error}>{viewModel.coordinationError} Press Enter to retry.</Text>
      )}
      {keybindings.diagnostic && (
        <Text color={PALETTE.text.error}>
          {`Keybindings ${keybindings.diagnostic.file} ${keybindings.diagnostic.path}: ${keybindings.diagnostic.message} Last valid bindings remain active.`}
        </Text>
      )}
      {keybindings.warnings.map((warning) => (
        <Text key={`${warning.path}:${warning.code}`} color={PALETTE.text.warning}>
          {`Keybindings ${warning.path}: ${warning.message}`}
        </Text>
      ))}
      <SessionEventNotices notices={viewModel.sessionEventNotices} />
      <Activity model={viewModel} />
      <Overlays model={viewModel} />
      <PromptAndStatus model={viewModel} />
    </Box>
  );
}
