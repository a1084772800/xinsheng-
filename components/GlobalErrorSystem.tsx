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
export const GlobalErrorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Modal State
    const [modalState, setModalState] = useState<ErrorModalState>({
        isOpen: false,
        title: '',
        message: '',
    });

    // Toast State
    const [toasts, setToasts] = useState<ToastState[]>([]);

    // --- Helpers ---
    const formatDetails = (details: any): string => {
        if (!details) return '';
        if (typeof details === 'object') {
            try {
                // If it's an Error object
                if (details instanceof Error) {
                     return `${details.name}: ${details.message}\n${details.stack || ''}`;
                }
                return JSON.stringify(details, null, 2);
            } catch (e) {
                return String(details);
            }
        }
        // Try to parse stringified JSON (common in API errors)
        if (typeof details === 'string') {
            try {
                if (details.trim().startsWith('{') || details.trim().startsWith('[')) {
                    const parsed = JSON.parse(details);
                    return JSON.stringify(parsed, null, 2);
                }
            } catch (e) {
                // ignore
            }
        }
        return String(details);
    };

    const showError = useCallback((title: string, message: string, details?: any, isFatal: boolean = false) => {
        setModalState({
            isOpen: true,
            title,
            message,
            details: formatDetails(details),
            isFatal 
        });
    }, []);

    const showToast = useCallback((message: string, type: 'success' | 'warning' | 'error' | 'info' = 'info') => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, type }]);
        
        // Auto remove
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    }, []);

    const closeError = () => {
        setModalState(prev => ({ ...prev, isOpen: false }));
    };

    // --- Listeners ---
    useEffect(() => {
        // 1. Subscribe to Error Bus (Service Layer Errors)
        const unsubscribeBus = errorBus.subscribe((err: AppError) => {
            // ONLY 'fatal' triggers a blocking modal now.
            // 'error', 'warning', 'info' trigger a Toast.
            if (err.level === 'fatal') {
                setModalState({
                    isOpen: true,
                    title: err.title || '系统错误',
                    message: err.message,
                    details: formatDetails(err.details),
                    isFatal: true
                });
            } else {
                // Map error levels to toast types
                const toastType = err.level === 'error' ? 'error' : (err.level === 'warning' ? 'warning' : 'info');
                showToast(err.message, toastType);
            }
        });

        // 2. Unhandled Rejection (Promises)
        const handleRejection = (event: PromiseRejectionEvent) => {
            console.error("Unhandled Rejection:", event.reason);
            const reason = event.reason?.message || String(event.reason);
            
            if (reason.includes('429') || reason.includes('Quota')) {
                // Demote to non-fatal toast for cleaner UX
                showToast('服务繁忙：AI 额度不足或拥堵，请稍后重试。', 'error');
            } else if (reason.includes('Failed to fetch') || reason.includes('Network')) {
                showToast('网络连接似乎断开了，正在尝试重连...', 'warning');
            }
        };

        // 3. Runtime Error
        const handleError = (event: ErrorEvent) => {
            // Filter out ResizeObserver loops which are benign
            if (event.message === 'ResizeObserver loop limit exceeded') return;
            console.error("Global Runtime Error:", event.error);
        };

        window.addEventListener('unhandledrejection', handleRejection);
        window.addEventListener('error', handleError);

        return () => {
            unsubscribeBus();
            window.removeEventListener('unhandledrejection', handleRejection);
            window.removeEventListener('error', handleError);
        };
    }, [showError, showToast]);

    return (
        <ErrorContext.Provider value={{ showError, showToast }}>
            <ErrorBoundary>
                {children}

                {/* --- TOASTS CONTAINER (PORTAL) --- */}
                {createPortal(
                    <div className="fixed top-6 left-0 right-0 z-[110] flex flex-col items-center gap-3 pointer-events-none px-4">
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
                    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={closeError}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-up ring-1 ring-slate-900/5 relative" onClick={e => e.stopPropagation()}>
                            
                            {/* Close Icon (Top Right) */}
                            <button 
                                onClick={closeError}
                                className="absolute top-3 right-3 p-2 bg-white/20 hover:bg-black/5 rounded-full text-slate-500 hover:text-slate-800 transition-colors z-10"
                            >
                                <span className="material-symbols-outlined text-sm font-bold">close</span>
                            </button>

                            <div className="bg-red-50 p-6 flex flex-col items-center text-center border-b border-red-100/50 pt-8">
                                <div className="w-14 h-14 rounded-full bg-red-100 text-red-500 flex items-center justify-center mb-4 shadow-inner">
                                    <span className="material-symbols-outlined text-3xl">sentiment_broken</span>
                                </div>
                                <h3 className="text-xl font-bold text-slate-800">{modalState.title}</h3>
                                <p className="text-sm text-slate-500 mt-2 leading-relaxed px-2">
                                    {modalState.message}
                                </p>
                            </div>

                            {modalState.details && (
                                <div className="bg-slate-50 px-6 py-3 border-b border-slate-100">
                                     <details className="text-xs text-slate-400">
                                         <summary className="cursor-pointer hover:text-slate-600 transition-colors list-none flex items-center justify-center gap-1">
                                             <span>显示技术详情</span>
                                             <span className="material-symbols-outlined text-[10px]">expand_more</span>
                                         </summary>
                                         <pre className="mt-3 p-3 bg-white border border-slate-200 rounded-lg overflow-x-auto font-mono custom-scrollbar max-h-32 text-left select-text whitespace-pre-wrap break-words">
                                             {modalState.details}
                                         </pre>
                                     </details>
                                </div>
                            )}

                            <div className="p-4 bg-white flex gap-3">
                                {/* Only show Refresh if fatal. Otherwise Close is primary. */}
                                <button 
                                    onClick={closeError}
                                    className={`flex-1 py-3 rounded-xl font-bold text-sm transition-colors ${!modalState.isFatal ? 'bg-slate-800 text-white hover:bg-slate-900 shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    {modalState.isFatal ? '关闭' : '知道了'}
                                </button>
                                
                                {modalState.isFatal && (
                                    <button 
                                        onClick={() => window.location.reload()}
                                        className={`flex-1 py-3 rounded-xl font-bold text-sm shadow-lg transition-transform active:scale-95 text-white flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 shadow-red-500/30`}
                                    >
                                        <span className="material-symbols-outlined text-lg">refresh</span>
                                        刷新
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </ErrorBoundary>
        </ErrorContext.Provider>
    );
};