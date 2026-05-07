import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorPanel } from '../error-panel';

type TErrorPanelIssue = ComponentProps<typeof ErrorPanel>['errors'][number];

const writeTextMock = vi.fn<[], Promise<void>>();

const runtimeError: TErrorPanelIssue = {
  type: 'runtime',
  severity: 'error',
  message: 'Runtime failure',
  line: 12,
  column: 4,
  stack: 'Error: runtime failure',
  code: 'throw new Error("runtime failure")',
  suggestions: ['Guard the nullable value'],
  documentation: 'https://example.com/runtime',
};

const importWarning: TErrorPanelIssue = {
  type: 'import',
  severity: 'warning',
  message: 'Import path is invalid',
};

beforeEach(() => {
  writeTextMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: writeTextMock,
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ErrorPanel', () => {
  it('renders the no-issue state when there are no errors or warnings', () => {
    render(<ErrorPanel errors={[]} warnings={[]} />);

    expect(screen.getByText('No errors or warnings detected')).toBeInTheDocument();
    expect(screen.queryByText('Issues Summary')).not.toBeInTheDocument();
  });

  it('summarizes issues and sorts errors before warnings', () => {
    render(<ErrorPanel errors={[runtimeError]} warnings={[importWarning]} />);

    expect(screen.getByText('Issues Summary')).toBeInTheDocument();
    expect(screen.getByText('Found 1 error and 1 warning')).toBeInTheDocument();
    expect(screen.getByText('1 Error')).toBeInTheDocument();
    expect(screen.getByText('1 Warning')).toBeInTheDocument();
    expect(screen.getByText('Runtime Error')).toBeInTheDocument();
    expect(screen.getByText('Import Error')).toBeInTheDocument();
    expect(screen.getByText('Line 12')).toBeInTheDocument();

    const issueMessages = screen
      .getAllByText(/Runtime failure|Import path is invalid/u)
      .map((element) => element.textContent);

    expect(issueMessages).toEqual(['Runtime failure', 'Import path is invalid']);
  });

  it('expands issue details, applies suggestions, and copies debug information', async () => {
    const onFixSuggestion = vi.fn();
    render(<ErrorPanel errors={[runtimeError]} warnings={[]} onFixSuggestion={onFixSuggestion} />);

    fireEvent.click(screen.getByText('Runtime failure'));

    expect(screen.getByText('Code Context')).toBeInTheDocument();
    expect(screen.getByText('throw new Error("runtime failure")')).toBeInTheDocument();
    expect(screen.getByText('Stack Trace')).toBeInTheDocument();
    expect(screen.getByText('Error: runtime failure')).toBeInTheDocument();
    expect(screen.getByText('Suggested Fixes')).toBeInTheDocument();
    expect(screen.getByText('Guard the nullable value')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Documentation' })).toHaveAttribute(
      'href',
      'https://example.com/runtime',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onFixSuggestion).toHaveBeenCalledWith('Guard the nullable value');

    fireEvent.click(screen.getByRole('button', { name: 'Copy Debug Info' }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
    });
    const copiedDebugInfo = String(writeTextMock.mock.calls.at(-1)?.[0]);
    expect(copiedDebugInfo).toContain('"type": "runtime"');
    expect(copiedDebugInfo).toContain('"message": "Runtime failure"');
    expect(copiedDebugInfo).toContain('"location": "Line 12, Column 4"');
  });
});
