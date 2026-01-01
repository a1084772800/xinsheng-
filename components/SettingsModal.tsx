import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { storageService } from '../services/storageService';
import { useGlobalError } from './GlobalErrorSystem';
import { testConnection } from '../services/geminiService';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [apiKey, setApiKey] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [testMessage, setTestMessage] = useState('');
    
    const { showToast } = useGlobalError();

    useEffect(() => {
        if (isOpen) {
            const loadSettings = async () => {
                const settings = await storageService.getSettings();
                if (settings) {
                    setApiKey(settings.apiKey || '');
                    setBaseUrl(settings.baseUrl || '');
                }
            };
            loadSettings();
            setTestStatus('idle');
            setTestMessage('');
        }
    }, [isOpen]);

    // Helper: Sanitize API Key specifically for iOS/Mobile copy-paste issues
    const sanitizeKey = (input: string) => {
        if (!input) return '';
        let cleaned = input.trim();
        
        // 1. Remove invisible characters (Zero-width space, etc.)
        // \u200B: Zero-width space
        // \u200C: Zero-width non-joiner
        // \u200D: Zero-width joiner
        // \uFEFF: Zero-width no-break space
        // \u2060: Word joiner
        cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');

        // 2. Replace iOS smart punctuation (Smart dashes)
        // En-dash, Em-dash -> Hyphen
        cleaned = cleaned.replace(/[\u2013\u2014]/g, '-');

        // 3. Remove any internal whitespace that shouldn't be there (API keys are continuous)
        cleaned = cleaned.replace(/\s+/g, '');

        return cleaned;
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const cleanKey = sanitizeKey(apiKey);
            
            // Check for invalid placeholder key often injected by IDX/CI
            if (cleanKey === 'UNUSED_PLACEHOLDER_FOR_API_KEY') {
                showToast("无效的 API Key", "error");
                setApiKey(''); // Clear it to force re-entry
                setTestMessage("检测到占位符 Key。请填入真实的 Gemini API Key。");
                setTestStatus('error');
                setIsSaving(false);
                return;
            }
            
            // UX: If we cleaned something, verify visually or just save silently.
            if (apiKey.length > 0 && cleanKey !== apiKey) {
                console.log("Auto-fixed API Key format");
                setApiKey(cleanKey); 
            }

            await storageService.saveSettings({
                apiKey: cleanKey,
                baseUrl: baseUrl.trim()
            });
            showToast("设置已保存", "success");
            onClose();
            // Reload page to ensure all services pick up new config cleanly
            setTimeout(() => window.location.reload(), 500);
        } catch (e) {
            showToast("保存失败", "error");
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestConnection = async () => {
        // Use sanitized key for test
        const cleanKey = sanitizeKey(apiKey);
        
        if (cleanKey === 'UNUSED_PLACEHOLDER_FOR_API_KEY') {
             setTestStatus('error');
             setTestMessage("这是系统的默认占位符，不是有效的 Key。请替换它。");
             return;
        }

        setApiKey(cleanKey);

        // Temporarily save to ensure test uses current inputs
        await storageService.saveSettings({
            apiKey: cleanKey,
            baseUrl: baseUrl.trim()
        });

        setTestStatus('testing');
        setTestMessage('正在连接...');
        
        const result = await testConnection();
        setTestStatus(result.success ? 'success' : 'error');
        setTestMessage(result.message);
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-up ring-1 ring-slate-900/5 max-h-[90vh] flex flex-col">
                <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <span className="material-symbols-outlined text-brand-500">settings</span>
                        应用设置
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                
                <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                    {/* Status Alert */}
                    <div className="bg-amber-50 border border-amber-100 p-3 rounded-xl flex gap-3 text-xs text-amber-800 leading-relaxed">
                        <span className="material-symbols-outlined text-lg flex-none">warning</span>
                        <div>
                            <p className="font-bold mb-1">为什么 Safari 能用，微信不能？</p>
                            <p>
                                iOS Safari 浏览器通常默认开启了 <b>iCloud 专用代理</b>，它可以帮您绕过网络封锁直连 Google。
                            </p>
                            <p className="mt-2">
                                但 <b>微信 / 谷歌浏览器 (APP)</b> 无法使用 iCloud 代理，因此请求会被阻断 (Load Failed)。
                                <br/>
                                <span className="font-bold text-red-600">解决方案：</span> 请在下方填入 API 代理地址 (Base URL)，或开启系统全局 VPN。
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                            Gemini API Key
                        </label>
                        <input 
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            onPaste={(e) => {
                                const text = e.clipboardData.getData('text');
                                if (text) {
                                    e.preventDefault();
                                    setApiKey(sanitizeKey(text));
                                }
                            }}
                            placeholder="输入您的 API Key"
                            className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none text-sm font-mono"
                        />
                        <p className="text-[10px] text-slate-400">
                            系统会自动移除复制时可能产生的隐形空格。
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                            API 代理地址 (Base URL)
                        </label>
                        <input 
                            type="text"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder="例如: https://my-proxy.com"
                            className="w-full px-4 py-2 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none text-sm font-mono"
                        />
                        <p className="text-[10px] text-slate-400">
                            如果您无法直连 Google，请填写反向代理地址。地址需包含协议头 (https://)。
                        </p>
                    </div>

                    {/* Diagnosis Area */}
                    <div className="border-t border-slate-100 pt-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-slate-500 uppercase">连接诊断</span>
                            {testStatus !== 'idle' && (
                                <span className={`text-xs font-bold ${testStatus === 'success' ? 'text-green-600' : testStatus === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                                    {testStatus === 'testing' ? '测试中...' : testStatus === 'success' ? '测试通过' : '测试失败'}
                                </span>
                            )}
                        </div>
                        
                        {testMessage && (
                            <div className={`text-xs p-2 rounded mb-2 ${testStatus === 'success' ? 'bg-green-50 text-green-700' : testStatus === 'error' ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>
                                {testMessage}
                            </div>
                        )}

                        <button
                            onClick={handleTestConnection}
                            disabled={testStatus === 'testing'}
                            className="w-full py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                        >
                            {testStatus === 'testing' ? <span className="material-symbols-outlined animate-spin text-sm">sync</span> : <span className="material-symbols-outlined text-sm">network_check</span>}
                            测试连接有效性
                        </button>
                    </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-6 py-2 bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700 shadow-lg shadow-brand-200 active:scale-95 transition-all flex items-center gap-2"
                    >
                        {isSaving ? <span className="material-symbols-outlined animate-spin text-sm">sync</span> : null}
                        保存并刷新
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};