import React from 'react';
import { AlertTriangle, Check, Copy, RotateCcw } from 'lucide-react';
import { redactSecrets, reportShadowError } from '../lib/errorStore';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  stack?: string;
  componentStack?: string;
  copied: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '', copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      message: error?.message || 'An unexpected application error occurred.',
      stack: error?.stack,
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const componentStack = info?.componentStack || undefined;
    this.setState({
      stack: error?.stack || this.state.stack,
      componentStack,
    });
    reportShadowError({
      source: 'UI Render Crash',
      title: error?.name ? `React ${error.name}` : 'React Component Crash',
      message: error?.message || 'Unhandled component rendering exception',
      rawDetail: componentStack ? `Component Stack:${componentStack}` : undefined,
      stack: error?.stack,
    });
  }

  override render() {
    if (this.state.hasError) {
      let friendly = redactSecrets(this.state.message);
      let rawJson: string | null = null;
      try {
        const parsed = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed.error && parsed.operationType) {
          friendly = `Database ${parsed.operationType} failed on "${parsed.path ?? 'collection'}": ${redactSecrets(parsed.error)}`;
          rawJson = redactSecrets(JSON.stringify(parsed, null, 2));
        }
      } catch {
        // non-JSON error
      }

      const techDetails = [
        rawJson ? `Payload:\n${rawJson}` : '',
        this.state.stack ? `Stack Trace:\n${redactSecrets(this.state.stack)}` : '',
        this.state.componentStack
          ? `Component Stack:${redactSecrets(this.state.componentStack)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const handleCopy = async () => {
        try {
          await navigator.clipboard.writeText(
            [`Error: ${friendly}`, techDetails].filter(Boolean).join('\n\n')
          );
          this.setState({ copied: true });
          window.setTimeout(() => this.setState({ copied: false }), 2000);
        } catch {
          // ignore clipboard errors
        }
      };

      return (
        <div className="min-h-screen bg-[#0B0E14] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-2xl w-full bg-[#121620] border border-rose-500/30 rounded-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-lg font-semibold text-slate-100">Application Error Details</h2>
            </div>
            <p className="text-sm text-rose-100 leading-relaxed whitespace-pre-wrap break-words">
              {friendly}
            </p>
            {techDetails && (
              <pre className="p-3 rounded-lg bg-black/60 border border-white/10 text-[11px] font-mono text-slate-300 max-h-64 overflow-auto whitespace-pre-wrap break-words">
                {techDetails}
              </pre>
            )}
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 text-slate-950 font-medium text-sm hover:bg-sky-400 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Reload Application
              </button>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.08] border border-white/12 text-slate-200 font-medium text-sm hover:bg-white/[0.14] transition-colors cursor-pointer"
              >
                {this.state.copied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                <span>{this.state.copied ? 'Copied Details' : 'Copy Error Details'}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
