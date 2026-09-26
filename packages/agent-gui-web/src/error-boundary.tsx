import React from 'react';

export interface IErrorBoundaryState {
  error: Error | null;
}

/** Catches a render error below it and shows the message and stack instead of a blank page. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  IErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): IErrorBoundaryState {
    return { error };
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-8">
          <div className="max-w-[600px] text-[15px] text-[var(--destructive)]">
            <p className="mb-2 text-[20px] font-semibold text-[var(--foreground)]">
              Robota hit an error
            </p>
            <p className="text-[var(--muted-foreground)] mb-2">{this.state.error.message}</p>
            <pre className="overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--card)] p-4 font-mono text-[12.5px] leading-relaxed text-[var(--muted-foreground)]">
              {this.state.error.stack}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
