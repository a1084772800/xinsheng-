import React, { Component, createContext, useContext, useState, useEffect, useCallback, ReactNode, ErrorInfo } from 'react';
import { createPortal } from 'react-dom';
import { errorBus, AppError } from '../services/errorBus';

interface ErrorContextType {
    showError: (title: string, message: string, details?: any, isFatal?: boolean) => void;
    showToast: (message: string, type?: 'success' | 'warning' | 'error' | 'info') => void;
}

const ErrorContext = createContext<ErrorContextType | null>(null);

export const useGlobalError = () => {
    const context = useContext(ErrorContext);
    if (!context) {
        throw new Error('useGlobalError must be used within a GlobalErrorProvider');
    }
    return context;
};

interface ErrorModalState {
    isOpen: boolean;
    title: string;
    message: string;
    details?: string;
    isFatal?: boolean;
}

interface ToastState {
    id: number;
    message: string;
    type: 'success' | 'warning' | 'error' | 'info';
}

interface ErrorBoundaryProps {
    children?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

// --- ERROR BOUNDARY COMPONENT ---
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null
        };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("React Error Boundary Caught:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
                    <div className="w-20 h-20 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-red-100">
                        <span className="material-symbols-outlined text-4xl">emergency_home</span>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800 mb-2">页面遇到了一点问题</h1>
                    <p className="text-slate-500 max-w-md mb-8 leading-relaxed">
                        抱歉，程序发生了一个意料之外的错误。请尝试刷新页面。
                        <br/>
                        <span className="text-xs bg-slate-100 px-2 py-1 rounded mt-2 inline-block font-mono text-slate-400">
                            {this.state.error?.message || "Unknown Error"}
                        </span>
                    </p>
                    <button 
                        onClick={() => window.location.reload()}
                        className="px-8 py-3 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined">refresh</span>
                        重新加载
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// --- PROVIDER COMPONENT ---
export const GlobalErrorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Modal State
    const [modalState, setModalState] = useState<ErrorModalState>({
        isOpen: false,
        title: '',
        message: '',
        details: '',
        isFatal: false
    });

    // Toast State
    const [toasts, setToasts] = useState<ToastState[]>([]);

    const closeError = () => {
        if (!modalState.isFatal) {
            setModalState(prev => ({ ...prev, isOpen: false }));
        }
    };

    const showError = useCallback((title: string, message: string, details?: any, isFatal: boolean = false) => {
        setModalState({
            isOpen: true,
            title,
            message,
            details: typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details || ''),
            isFatal
        });
    }, []);

    const showToast = useCallback((message: string, type: 'success' | 'warning' | 'error' | 'info' = 'info') => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, type }]);
        // Auto remove after 3s
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    }, []);

    // Listen to Error Bus
    useEffect(() => {
        const unsubscribe = errorBus.subscribe((err: AppError) => {
            if (err.level === 'fatal') {
                showError(err.title || 'Error', err.message, err.details, true);
            } else {
                showToast(err.message, err.level === 'error' ? 'error' : (err.level === 'warning' ? 'warning' : 'info'));
            }
        });
        return unsubscribe;
    }, [showError, showToast]);

    return (
        <ErrorContext.Provider value={{ showError, showToast }}>
            <ErrorBoundary>
                {children}
            </ErrorBoundary>

            {/* --- TOASTS CONTAINER (PORTAL) --- */}
            {createPortal(
                <div className="fixed top-16 left-0 right-0 z-[110] flex flex-col items-center gap-3 pointer-events-none px-4">
                    {toasts.map(toast => (
                        <div 
                            key={toast.id}
                            className={`
                                pointer-events-auto px-6 py-3 rounded-full shadow-xl font-bold text-sm flex items-center gap-3
                                animate-slide-in-top transition-all backdrop-blur-md
                                ${toast.type === 'error' ? 'bg-red-500/95 text-white' : 
                                  toast.type === 'warning' ? 'bg-amber-400/95 text-slate-900' : 
                                  toast.type === 'success' ? 'bg-green-500/95 text-white' : 
                                  'bg-slate-800/95 text-white'}
                            `}
                        >
                            <span className="material-symbols-outlined text-lg">
                                {toast.type === 'error' ? 'error' : 
                                 toast.type === 'warning' ? 'warning' : 
                                 toast.type === 'success' ? 'check_circle' : 'info'}
                            </span>
                            {toast.message}
                        </div>
                    ))}
                </div>,
                document.body
            )}

            {/* --- ERROR MODAL UI (PORTAL) --- */}
            {modalState.isOpen && createPortal(
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-up ring-1 ring-slate-900/5 relative">
                        <div className="bg-white p-6 text-center">
                            <div className="w-14 h-14 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4 border border-red-100">
                                <span className="material-symbols-outlined text-3xl">error</span>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">{modalState.title}</h3>
                            <p className="text-slate-600 text-sm leading-relaxed">{modalState.message}</p>
                            
                            {modalState.details && (
                                <details className="mt-4 text-left border-t border-slate-100 pt-3">
                                    <summary className="text-xs text-slate-400 cursor-pointer list-none flex items-center justify-center gap-1 hover:text-slate-600">
                                        查看详情 <span className="material-symbols-outlined text-[10px]">expand_more</span>
                                    </summary>
                                    <pre className="mt-2 text-[10px] bg-slate-50 p-2 rounded text-slate-500 overflow-auto max-h-32 font-mono">
                                        {modalState.details}
                                    </pre>
                                </details>
                            )}
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100">
                            {modalState.isFatal ? (
                                <button onClick={() => window.location.reload()} className="w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold transition-colors shadow-lg shadow-red-200">
                                    重新加载应用
                                </button>
                            ) : (
                                <button onClick={closeError} className="w-full py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors">
                                    知道了
                                </button>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </ErrorContext.Provider>
    );
};