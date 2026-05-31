import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

const NON_FATAL_RUNTIME_MESSAGES = [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications.',
];

const toError = (reason: unknown): Error => {
    if (reason instanceof Error) {
        return reason;
    }

    if (typeof reason === 'string') {
        return new Error(reason);
    }

    try {
        return new Error(JSON.stringify(reason));
    } catch {
        return new Error(String(reason));
    }
};

const isIgnorableRuntimeError = (error: Error): boolean => {
    if (error.name === 'AbortError') {
        return true;
    }

    return NON_FATAL_RUNTIME_MESSAGES.some((message) => error.message.includes(message));
};

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public componentDidMount() {
        window.addEventListener('error', this.handleWindowError);
        window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    }

    public componentWillUnmount() {
        window.removeEventListener('error', this.handleWindowError);
        window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    }

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    private handleWindowError = (event: ErrorEvent) => {
        const runtimeError = event.error instanceof Error
            ? event.error
            : new Error(event.message || 'Unknown runtime error');

        this.promoteRuntimeError(runtimeError, 'window.error');
    };

    private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
        const runtimeError = toError(event.reason);

        if (isIgnorableRuntimeError(runtimeError)) {
            return;
        }

        // Prevent duplicate browser-level noise once we surface this in-app.
        event.preventDefault();
        this.promoteRuntimeError(runtimeError, 'window.unhandledrejection');
    };

    private promoteRuntimeError(error: Error, source: string) {
        if (isIgnorableRuntimeError(error)) {
            return;
        }

        this.setState((prevState) => {
            if (prevState.hasError && prevState.error?.message === error.message) {
                return prevState;
            }

            return {
                hasError: true,
                error,
            };
        });

        console.error(`[Runtime] ${source}:`, error);
    }

    private handleRecover = () => {
        this.setState({ hasError: false, error: null });
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="w-screen h-screen flex flex-col items-center justify-center bg-black text-red-500 font-mono p-8">
                    <h1 className="text-4xl mb-4 font-bold">SYSTEM FAILURE</h1>
                    <p className="text-xl mb-8">The Exegete has encountered a critical error.</p>
                    <div className="bg-red-900/20 p-4 rounded border border-red-500/50 max-w-2xl overflow-auto">
                        <code className="text-sm whitespace-pre-wrap">
                            {this.state.error?.toString()}
                        </code>
                    </div>
                    <div className="mt-8 flex flex-wrap gap-3 justify-center">
                        <button
                            className="px-6 py-2 border border-red-500 text-red-300 hover:bg-red-500 hover:text-black transition-colors"
                            onClick={this.handleRecover}
                        >
                            TRY RECOVERY
                        </button>
                        <button
                            className="px-6 py-2 border border-red-500 hover:bg-red-500 hover:text-black transition-colors"
                            onClick={() => window.location.reload()}
                        >
                            REBOOT SYSTEM
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
