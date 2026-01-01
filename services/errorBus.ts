
export type ErrorLevel = 'info' | 'warning' | 'error' | 'fatal';

export interface AppError {
    message: string;
    title?: string;
    level: ErrorLevel;
    details?: any;
    duration?: number; // For toasts
    openSettings?: boolean; // Trigger settings modal opening
}

type ErrorListener = (error: AppError) => void;

class ErrorBus {
    private listeners: ErrorListener[] = [];

    emit(error: AppError) {
        // Prevent flooding: debounce exact same errors within 1s if needed
        // For simplicity, just emit
        this.listeners.forEach(l => l(error));
        
        // Always log to console for dev
        if (error.level === 'fatal' || error.level === 'error') {
            console.error(`[ErrorBus] ${error.title}: ${error.message}`, error.details);
        } else {
            console.warn(`[ErrorBus] ${error.title}: ${error.message}`);
        }
    }

    subscribe(listener: ErrorListener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }
}

export const errorBus = new ErrorBus();
