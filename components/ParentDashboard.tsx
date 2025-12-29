import React, { useState, useEffect, useMemo } from 'react';
import { generateStoryScript, cacheStoryAssets, initializeAudio, getSystemVoices, AVAILABLE_TTS_MODELS, AVAILABLE_VOICES } from '../services/geminiService';
import { storageService } from '../services/storageService';
import { Story, StoryNode, UserStats, ReportData } from '../types';
import { StoryGraph } from './StoryGraph';
import { useGlobalError } from './GlobalErrorSystem';
import { ChatDataDashboard } from './ChatDataDashboard';

interface ParentDashboardProps {
    stories: Story[];
    userStats: UserStats;
    statDeltas: Partial<UserStats>;
    lastReport: ReportData | null; // Pass report data to show reasons
    onStoryGenerated: (story: Story) => void;
    onPlayStory: (storyId: string) => void;
    onStoryUpdate: (story: Story) => void;
    onStoryDelete: (storyId: string) => void; // Sync with parent
}

const STYLES = [
    { id: 'Adventure', icon: 'explore', label: '奇幻冒险' },
    { id: 'Bedtime', icon: 'bedtime', label: '睡前疗愈' },
    { id: 'Funny', icon: 'sentiment_very_satisfied', label: '幽默搞笑' },
    { id: 'Educational', icon: 'school', label: '科普教育' },
];

interface VoiceOption {
    id: string;
    label: string;
    desc: string;
    type: 'cloud' | 'local';
}

export const ParentDashboard: React.FC<ParentDashboardProps> = ({ 
    stories: initialStories, 
    userStats, 
    statDeltas,
    lastReport,
    onStoryGenerated, 
    onPlayStory, 
    onStoryUpdate,
    onStoryDelete
}) => {
    // Hooks
    const { showError, showToast } = useGlobalError();

    // Inputs
    const [prompt, setPrompt] = useState('');
    const [protagonist, setProtagonist] = useState('');
    const [selectedVoice, setSelectedVoice] = useState('Kore');
    const [customStyle, setCustomStyle] = useState('奇幻冒险');
    
    // Voice List State
    const [systemVoices, setSystemVoices] = useState<VoiceOption[]>([]);
    
    // Advanced Settings
    const [selectedModel, setSelectedModel] = useState(AVAILABLE_TTS_MODELS[0].id);
    
    // State
    const [localStories, setLocalStories] = useState<Story[]>(initialStories); // Init directly from props
    const [isLoading, setIsLoading] = useState(false);
    
    // Manage preview state
    const [previewStoryId, setPreviewStoryId] = useState<string | null>(initialStories.length > 0 ? initialStories[0].id : null);
    const [viewMode, setViewMode] = useState<'preview' | 'graph'>('graph');
    
    // Download State
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);

    // Delete Confirmation State - NEW
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    // Derived state for Cloud vs Local
    const isLocalModel = selectedModel === 'browser-tts';

    // Load System Voices on Mount
    useEffect(() => {
        getSystemVoices().then(voices => {
            setSystemVoices(voices);
        });
    }, []);

    // Effect: Switch default voice when switching between Cloud and Local models
    useEffect(() => {
        if (isLocalModel) {
            const isCurrentVoiceCloud = AVAILABLE_VOICES.some(v => v.id === selectedVoice);
            if (isCurrentVoiceCloud && systemVoices.length > 0) {
                setSelectedVoice(systemVoices[0].id);
            }
        } else {
             const isCurrentVoiceLocal = systemVoices.some(v => v.id === selectedVoice);
             if (isCurrentVoiceLocal) {
                 setSelectedVoice(AVAILABLE_VOICES[0].id);
             }
        }
    }, [isLocalModel, systemVoices, selectedVoice]);

    // Full Sync with Parent State (Source of Truth)
    useEffect(() => {
        setLocalStories(initialStories);
        // If the currently previewed story was deleted (not in new list), reset preview
        setPreviewStoryId(prev => {
            const stillExists = initialStories.find(s => s.id === prev);
            if (stillExists) return prev;
            return initialStories.length > 0 ? initialStories[0].id : null;
        });
    }, [initialStories]);

    const previewStory = localStories.find(s => s.id === previewStoryId) || localStories[0];

    const handleDownload = async (story: Story, silent: boolean = false) => {
        if (downloadingId) return;
        setDownloadingId(story.id);
        setDownloadProgress(0);

        try {
            const updatedStory = await cacheStoryAssets(story, (current, total) => {
                setDownloadProgress(Math.round((current / total) * 100));
            });
            // Update local state temporarily (Parent state will update via onStoryUpdate later if needed, but App.tsx handles optimistic updates)
            onStoryUpdate(updatedStory);
            if (!silent && !story.isOfflineReady) {
                 showToast("资源缓存完成", "success");
            }
        } catch (e: any) {
            console.error("Download failed", e);
            if (silent) {
                // In silent mode (auto-cache), use a non-intrusive toast instead of a modal
                showToast("后台资源加载受限，但您仍可正常阅读故事", "warning");
            } else {
                showError("缓存失败", "下载故事资源时遇到网络问题，请检查连接后重试。", e, false);
            }
        } finally {
            setDownloadingId(null);
            setDownloadProgress(0);
        }
    };

    // --- NEW: Two-Step Delete Logic ---
    const handleDeleteClick = (e: React.MouseEvent, storyId: string) => {
        e.stopPropagation();
        
        if (deleteConfirmId === storyId) {
            // Second click: Confirmed, Perform Delete
            performDelete(storyId);
        } else {
            // First click: Enter confirm state
            setDeleteConfirmId(storyId);
            // Auto-reset after 3s if not confirmed
            setTimeout(() => {
                // Only reset if it's still the same ID (prevent clearing a new selection)
                setDeleteConfirmId(current => current === storyId ? null : current);
            }, 3000);
        }
    };

    const performDelete = async (storyId: string) => {
        try {
            await storageService.deleteStory(storyId);
            
            // 1. Notify Parent (Global State Update) - This fixes the Child Mode sync issue
            onStoryDelete(storyId);

            // 2. Local State Update (Optimistic UI update)
            setLocalStories(prev => {
                const newList = prev.filter(s => s.id !== storyId);
                if (previewStoryId === storyId) {
                    setPreviewStoryId(newList.length > 0 ? newList[0].id : null);
                }
                return newList;
            });
            
            setDeleteConfirmId(null);
            showToast("故事已删除", "success");
        } catch (error) {
            console.error("Failed to delete story", error);
            showToast("删除失败，请稍后重试", "error");
        }
    };

    const handleGenerate = async () => {
        if (!protagonist.trim()) {
            showToast("请先输入主角的名字（例如：乐乐）", "warning");
            return;
        }
        if (!prompt.trim()) {
            showToast("请描述一下您想听的故事灵感", "warning");
            return;
        }

        setIsLoading(true);
        try {
            const story = await generateStoryScript(
                prompt, 
                customStyle, 
                selectedVoice, 
                protagonist,
                selectedModel
            );
            onStoryGenerated(story);
            // Local update for immediate feedback, though prop update will follow
            setLocalStories(prev => [story, ...prev]);
            setPreviewStoryId(story.id); 
            setViewMode('graph'); 

            // Feature 3: Auto-Cache immediately after generation
            handleDownload(story, true);
        } catch (e: any) {
            console.error(e);
            let msg = "生成故事失败，请重试。";
            let title = "生成失败";
            
            if (e.message && e.message.includes("API Key")) {
                title = "配置错误";
                msg = "API Key 未配置。请检查环境设置。";
            } else if (e.message && e.message.includes("Quota")) {
                 title = "配额不足";
                 msg = "API 配额不足，请稍后再试。";
            } else if (e.message && (e.message.includes("fetch") || e.message.includes("Network"))) {
                 msg = "连接云端 AI 失败。虽然使用本地语音，但剧本创作仍需联网。";
            }
            
            showToast(`${title}: ${msg}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartInteraction = (storyId: string) => {
        initializeAudio();
        onPlayStory(storyId);
    };

    const getSortedNodes = (story: Story) => {
        const nodes = Object.values(story.nodes);
        return nodes.sort((a, b) => {
            if (a.id === 'start') return -1;
            if (b.id === 'start') return 1;
            if (a.type === 'end' && b.type !== 'end') return 1;
            if (a.type !== 'end' && b.type === 'end') return -1;
            return a.id.localeCompare(b.id);
        });
    };

    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-24">
            
            {/* 1. Hero / Generator Section */}
            <div className="bg-white rounded-3xl p-1 shadow-sm border border-slate-100 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-400 via-accent-400 to-brand-600"></div>
                
                <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                    {/* Left: Introduction */}
                    <div className="lg:col-span-4 space-y-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand-50 text-brand-600 rounded-full text-xs font-bold uppercase tracking-wider">
                            <span className="material-symbols-outlined text-sm">auto_awesome</span>
                            AI 故事工坊
                        </div>
                        <h2 className="text-3xl font-bold text-slate-800 leading-tight">
                            释放想象力<br/>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-accent-600">定制专属声音旅程</span>
                        </h2>
                        <p className="text-slate-500 text-sm leading-relaxed">
                            在这里，没有固定的选项。描述您脑海中的奇思妙想，选择最喜欢的声音，AI 将为您和孩子编织一个独一无二的互动世界。
                        </p>
                    </div>

                    {/* Right: Inputs */}
                    <div className="lg:col-span-8 bg-slate-50 rounded-2xl p-6 border border-slate-100 space-y-6">
                        
                        {/* Section: Story Basics */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">主角名字</label>
                                <input 
                                    value={protagonist}
                                    onChange={(e) => setProtagonist(e.target.value)}
                                    className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none transition-all shadow-sm text-sm font-medium" 
                                    placeholder="例如：乐乐" 
                                    type="text" 
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">故事风格</label>
                                <div className="space-y-2">
                                    <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                        {STYLES.map(style => (
                                            <button
                                                key={style.id}
                                                onClick={() => setCustomStyle(style.label)}
                                                className={`flex-none px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${customStyle === style.label ? 'bg-brand-600 text-white border-brand-700 shadow-md shadow-brand-200' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}`}
                                            >
                                                <span className="material-symbols-outlined text-sm">{style.icon}</span>
                                                {style.label}
                                            </button>
                                        ))}
                                    </div>
                                    <input 
                                        value={customStyle}
                                        onChange={(e) => setCustomStyle(e.target.value)}
                                        className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none transition-all"
                                        placeholder="或输入自定义..."
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Section: Advanced Settings (Model) Moved Up for clarity */}
                         <div className="space-y-2">
                            <div className="flex justify-between items-end">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">TTS 模型引擎</label>
                            </div>
                            <select 
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none text-sm font-medium shadow-sm"
                            >
                                {AVAILABLE_TTS_MODELS.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-slate-400 ml-1">
                                {AVAILABLE_TTS_MODELS.find(m => m.id === selectedModel)?.desc}
                            </p>
                        </div>

                        {/* Section: Audio & Voice */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">
                                讲述声音 ({isLocalModel ? '本地系统' : '云端 AI'})
                            </label>
                            <div className="relative">
                                <select 
                                    value={selectedVoice}
                                    onChange={(e) => setSelectedVoice(e.target.value)}
                                    className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none appearance-none text-sm font-medium cursor-pointer shadow-sm disabled:opacity-50"
                                >
                                    {isLocalModel ? (
                                        systemVoices.length > 0 ? (
                                            systemVoices.map(voice => (
                                                <option key={voice.id} value={voice.id}>
                                                    {voice.label} — {voice.desc}
                                                </option>
                                            ))
                                        ) : (
                                            <option value="">未检测到本地中文语音，请检查浏览器设置</option>
                                        )
                                    ) : (
                                        AVAILABLE_VOICES.map(voice => (
                                            <option key={voice.id} value={voice.id}>
                                                {voice.label} — {voice.desc}
                                            </option>
                                        ))
                                    )}
                                </select>
                                <div className="absolute right-4 top-1/2 transform -translate-y-1/2 pointer-events-none text-slate-500">
                                    <span className="material-symbols-outlined">expand_more</span>
                                </div>
                            </div>
                        </div>

                        {/* Prompt & Action */}
                        <div className="space-y-2 pt-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">创意灵感 (越详细越好)</label>
                            <textarea 
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                className="w-full px-5 py-4 rounded-2xl border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none transition-all shadow-sm text-base min-h-[120px] resize-y leading-relaxed" 
                                placeholder="例如：乐乐是一只住在深海里的小鲸鱼，他今天想去海面上看看星星，但是他有点怕黑，路上遇到了发光的水母..." 
                            />
                        </div>

                        <button 
                            disabled={isLoading}
                            onClick={handleGenerate}
                            className={`w-full py-4 bg-gradient-to-r from-brand-600 to-accent-600 hover:from-brand-500 hover:to-accent-500 text-white rounded-xl font-bold transition-all flex justify-center items-center gap-2 shadow-lg shadow-brand-500/20 ${isLoading ? 'opacity-70 cursor-not-allowed' : 'hover:scale-[1.01] hover:shadow-xl'}`}
                        >
                            {isLoading ? (
                                <span className="material-symbols-outlined animate-spin">refresh</span>
                            ) : (
                                <span className="material-symbols-outlined text-yellow-300">magic_button</span>
                            )}
                            {isLoading ? '正在编写长篇剧本...' : '开始创作'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                
                {/* 2. Left Column: Active Story Preview */}
                <div className="lg:col-span-8 space-y-6">
                    <div className="flex items-center justify-between">
                         <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <span className="w-2 h-6 bg-brand-500 rounded-full"></span>
                            当前剧本预览
                        </h3>
                        {previewStory && (
                            <div className="flex items-center gap-3">
                                <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                                    <button 
                                        onClick={() => setViewMode('graph')}
                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${viewMode === 'graph' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                                    >
                                        <span className="material-symbols-outlined text-sm">account_tree</span> 结构图
                                    </button>
                                    <button 
                                        onClick={() => setViewMode('preview')}
                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${viewMode === 'preview' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                                    >
                                        <span className="material-symbols-outlined text-sm">description</span> 剧本
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-white rounded-3xl border border-slate-200 min-h-[500px] shadow-sm flex flex-col overflow-hidden relative">
                        {previewStory ? (
                            <>
                                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 backdrop-blur-sm sticky top-0 z-20">
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                                            {previewStory.title}
                                            <span className="px-2 py-0.5 bg-brand-100 text-brand-700 text-[10px] rounded-full border border-brand-200 uppercase tracking-wide">{previewStory.style || 'Custom'}</span>
                                        </h4>
                                        <p className="text-xs text-slate-400 mt-1 flex items-center gap-3">
                                            <span>{Object.keys(previewStory.nodes).length} 节点</span>
                                            <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">record_voice_over</span> 
                                                <span className="truncate max-w-[100px]">{previewStory.voice}</span>
                                            </span>
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        
                                        {/* OPTIMIZED DELETE BUTTON: 2-step confirmation logic directly in the UI */}
                                        <button
                                            onClick={(e) => handleDeleteClick(e, previewStory.id)}
                                            className={`
                                                flex items-center gap-1.5 px-3 py-2 rounded-full font-bold text-xs transition-all border
                                                ${deleteConfirmId === previewStory.id
                                                    ? 'bg-red-500 text-white border-red-600 animate-pulse shadow-red-200 shadow-lg'
                                                    : 'bg-white text-slate-400 border-slate-200 hover:border-red-300 hover:text-red-500'
                                                }
                                            `}
                                            title="删除故事"
                                        >
                                            <span className="material-symbols-outlined text-sm">
                                                {deleteConfirmId === previewStory.id ? 'warning' : 'delete'}
                                            </span>
                                            {deleteConfirmId === previewStory.id ? "确认删除？" : "删除"}
                                        </button>

                                        {/* Download Button - Hidden if Local TTS */}
                                        {previewStory.ttsModel !== 'browser-tts' && (
                                            <button 
                                                onClick={() => handleDownload(previewStory)}
                                                disabled={!!downloadingId || previewStory.isOfflineReady}
                                                className={`
                                                    flex items-center gap-1.5 px-3 py-2 rounded-full font-bold text-xs transition-all border
                                                    ${previewStory.isOfflineReady 
                                                        ? 'bg-green-50 text-green-700 border-green-200 cursor-default'
                                                        : downloadingId === previewStory.id 
                                                            ? 'bg-brand-50 text-brand-700 border-brand-200' 
                                                            : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300 hover:text-brand-600'
                                                    }
                                                `}
                                            >
                                                {previewStory.isOfflineReady ? (
                                                    <>
                                                        <span className="material-symbols-outlined text-sm">check_circle</span>
                                                        已缓存
                                                    </>
                                                ) : downloadingId === previewStory.id ? (
                                                    <>
                                                        <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                                                        {downloadProgress}%
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="material-symbols-outlined text-sm">download_for_offline</span>
                                                        缓存资源
                                                    </>
                                                )}
                                            </button>
                                        )}
                                        
                                        <button 
                                            onClick={() => handleStartInteraction(previewStory.id)} 
                                            className="pl-4 pr-5 py-2 bg-green-500 hover:bg-green-600 text-white rounded-full font-bold shadow-lg shadow-green-500/20 flex items-center gap-2 transition-transform hover:scale-105 active:scale-95"
                                        >
                                            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                                                <span className="material-symbols-outlined text-green-600 text-sm">play_arrow</span>
                                            </div>
                                            开始互动
                                        </button>
                                    </div>
                                </div>
                                
                                <div className="flex-1 bg-slate-50 overflow-hidden relative">
                                    {viewMode === 'graph' ? (
                                        <StoryGraph nodes={previewStory.nodes} startNodeId="start" />
                                    ) : (
                                        <div className="absolute inset-0 overflow-auto p-6 custom-scrollbar bg-slate-100">
                                            <div className="space-y-6 max-w-2xl mx-auto pb-20">
                                                {getSortedNodes(previewStory).map((node) => (
                                                    <div key={node.id} className={`
                                                        bg-white p-6 rounded-xl border shadow-sm relative overflow-hidden
                                                        ${node.id === 'start' ? 'border-brand-200 shadow-md ring-1 ring-brand-100' : 'border-slate-200'}
                                                        ${node.type === 'end' ? 'bg-slate-50 border-slate-300' : ''}
                                                    `}>
                                                        {/* Badge */}
                                                        {node.id === 'start' && <div className="absolute top-0 right-0 px-3 py-1 bg-brand-500 text-white text-[10px] font-bold rounded-bl-xl">START</div>}
                                                        {node.type === 'end' && <div className="absolute top-0 right-0 px-3 py-1 bg-slate-700 text-white text-[10px] font-bold rounded-bl-xl">THE END</div>}
                                                        {node.type === 'linear' && <div className="absolute top-0 right-0 px-3 py-1 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-bl-xl">SCENE</div>}

                                                        {/* Scene Header */}
                                                        <div className="flex items-center gap-2 mb-4 opacity-50">
                                                            <span className="text-[10px] font-mono uppercase tracking-widest font-bold">SCENE: {node.id}</span>
                                                            <div className="h-px flex-1 bg-slate-200"></div>
                                                        </div>

                                                        {/* Narrative */}
                                                        <div className="flex gap-4 mb-4">
                                                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 flex-none">
                                                                <span className="material-symbols-outlined">auto_stories</span>
                                                            </div>
                                                            <div className="flex-1">
                                                                <p className="font-serif text-slate-700 text-lg leading-relaxed text-justify">
                                                                    {node.text}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        {/* Interaction Block */}
                                                        {(node.type === 'choice' || node.type === 'linear') && (
                                                            <div className={`rounded-xl p-4 border mt-2 ${node.type === 'linear' ? 'bg-blue-50/50 border-blue-100/50' : 'bg-brand-50/50 border-brand-100/50'}`}>
                                                                {node.type === 'choice' && node.question && (
                                                                    <div className="flex gap-3 mb-3">
                                                                        <span className="text-xs font-bold text-brand-500 bg-brand-100 px-2 py-0.5 rounded self-start">提问</span>
                                                                        <p className="font-bold text-brand-800 text-sm">{node.question}</p>
                                                                    </div>
                                                                )}
                                                                
                                                                {node.type === 'choice' && node.options && node.options.length > 0 && (
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-0 sm:pl-10">
                                                                        {node.options.map((opt, i) => (
                                                                            <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white border border-brand-100 shadow-sm">
                                                                                <div>
                                                                                    <span className="text-xs font-bold text-slate-700 block">“{opt.label}”</span>
                                                                                    {opt.text !== opt.label && <span className="text-[10px] text-slate-400 block line-clamp-1">{opt.text}</span>}
                                                                                </div>
                                                                                <div className="flex items-center text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                                                                                    <span>to</span>
                                                                                    <span className="material-symbols-outlined text-[10px] mx-0.5">arrow_forward</span>
                                                                                    <span className="font-mono">{opt.next}</span>
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}

                                                                {node.type === 'linear' && node.next && (
                                                                    <div className="flex items-center justify-between p-2 rounded-lg bg-white/50 border border-blue-100 shadow-sm">
                                                                        <span className="text-xs font-bold text-slate-500 italic">自动继续...</span>
                                                                        <div className="flex items-center text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                                                                            <span>to</span>
                                                                            <span className="material-symbols-outlined text-[10px] mx-0.5">arrow_forward</span>
                                                                            <span className="font-mono">{node.next}</span>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                                
                                                {/* Bottom Spacer/Footer */}
                                                <div className="text-center opacity-30">
                                                    <span className="material-symbols-outlined text-4xl">more_horiz</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300">
                                <span className="material-symbols-outlined text-6xl mb-4 opacity-30">history_edu</span>
                                <p className="font-medium">暂无预览内容，请先生成故事</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* 3. Right Column: Stats & Library */}
                <div className="lg:col-span-4 space-y-8 flex flex-col h-full">
                    
                    {/* NEW: Chat Data Dashboard Card */}
                    <div className="h-[400px] flex-none transform transition-transform hover:scale-[1.01] duration-500">
                         <ChatDataDashboard userStats={userStats} reportData={lastReport} statDeltas={statDeltas} />
                    </div>

                    {/* Library List (Takes remaining height) */}
                    <div className="space-y-4 flex-1 min-h-0 flex flex-col">
                        <h3 className="text-lg font-bold text-slate-800 px-2 flex items-center justify-between flex-none">
                            <span>故事档案</span>
                            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-full">{localStories.length}</span>
                        </h3>
                        <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar flex-1">
                            {localStories.map(story => (
                                <div 
                                    key={story.id} 
                                    onClick={() => setPreviewStoryId(story.id)}
                                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex gap-3 group relative overflow-hidden ${previewStoryId === story.id ? 'bg-brand-600 border-brand-700 text-white shadow-lg shadow-brand-200 transform scale-[1.02]' : 'bg-white border-slate-200 hover:border-brand-300 hover:shadow-md'}`}
                                >
                                    <img src={story.cover} alt="" className="w-16 h-16 rounded-xl object-cover bg-slate-200" />
                                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                                        <h4 className={`font-bold truncate text-sm mb-1 ${previewStoryId === story.id ? 'text-white' : 'text-slate-800'}`}>{story.title}</h4>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border truncate max-w-[80px] ${previewStoryId === story.id ? 'bg-white/20 border-white/10 text-white/80' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
                                                {story.topic}
                                            </span>
                                            {story.isOfflineReady && (
                                                <span className={`material-symbols-outlined text-[14px] ${previewStoryId === story.id ? 'text-green-400' : 'text-green-600'}`}>
                                                    check_circle
                                                </span>
                                            )}
                                            <span className={`text-[10px] ml-auto ${previewStoryId === story.id ? 'text-white/40' : 'text-slate-300'}`}>{story.date}</span>
                                        </div>
                                    </div>
                                    
                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-1 self-center">
                                         {/* Play Button - Only shows when selected to avoid clutter */}
                                        {previewStoryId === story.id && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleStartInteraction(story.id); }} 
                                                className="p-2 bg-white/10 rounded-full hover:bg-white/20 text-white"
                                                title="播放"
                                            >
                                                <span className="material-symbols-outlined text-lg">play_arrow</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};