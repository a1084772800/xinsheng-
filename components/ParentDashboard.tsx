
import React, { useState, useEffect } from 'react';
import { generateStoryScript, cacheStoryAssets, initializeAudio, AVAILABLE_TTS_MODELS, AVAILABLE_GEN_MODELS } from '../services/geminiService';
import { storageService } from '../services/storageService';
import { Story } from '../types';
import { StoryGraph } from './StoryGraph';
import { useGlobalError } from './GlobalErrorSystem';

interface ParentDashboardProps {
    stories: Story[];
    onStoryGenerated: (story: Story) => void;
    onPlayStory: (storyId: string) => void;
    onStoryUpdate: (story: Story) => void;
    onStoryDelete: (storyId: string) => void; 
}

const STYLES = [
    { id: 'Watercolor', icon: 'palette', label: '梦幻水彩' },
    { id: 'Ghibli', icon: 'landscape', label: '吉卜力风' },
    { id: 'Clay', icon: 'toys', label: '粘土动画' },
    { id: 'PaperCut', icon: 'content_cut', label: '剪纸艺术' },
    { id: 'Crayon', icon: 'edit', label: '儿童蜡笔' },
];

export const ParentDashboard: React.FC<ParentDashboardProps> = ({ 
    stories: initialStories, 
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
    
    // Style State
    const [customStyle, setCustomStyle] = useState('梦幻水彩');
    
    // Model Selection State
    const [selectedModel, setSelectedModel] = useState(AVAILABLE_TTS_MODELS[0].id); // TTS Model
    const [selectedGenModel, setSelectedGenModel] = useState(AVAILABLE_GEN_MODELS[0].id); // Story Gen Model

    // State
    const [localStories, setLocalStories] = useState<Story[]>(initialStories); // Init directly from props
    const [isLoading, setIsLoading] = useState(false);
    
    // Manage preview state
    const [previewStoryId, setPreviewStoryId] = useState<string | null>(initialStories.length > 0 ? initialStories[0].id : null);
    const [viewMode, setViewMode] = useState<'preview' | 'graph'>('graph');
    
    // UI State for Story Selector Dropdown
    const [isSelectorOpen, setIsSelectorOpen] = useState(false);
    
    // Download State
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);

    // Delete Confirmation State - NEW
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    // Filter stories for the library view (Only show ready stories)
    const libraryStories = localStories.filter(s => s.isOfflineReady);

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
                 showToast("绘本资源已缓存", "success");
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
            // Always use 'auto' to let AI decide the persona
            const voiceToUse = 'auto';

            const story = await generateStoryScript(
                prompt, 
                customStyle, 
                voiceToUse, 
                protagonist,
                selectedModel, // TTS Model
                selectedGenModel // Gen Model
            );
            onStoryGenerated(story);
            // Local update for immediate feedback, though prop update will follow
            setLocalStories(prev => [story, ...prev]);
            setPreviewStoryId(story.id); 
            setViewMode('graph'); 

            // Auto-cache removed to save tokens. User must click "Generate Assets".
            showToast("故事骨架已生成，请在右侧预览并生成配图", "success");
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
                 msg = "网络连接失败，请检查设置。如果在国内使用，请在设置中配置API代理。";
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
                            AI 绘本造梦师
                        </div>
                        <h2 className="text-3xl font-bold text-slate-800 leading-tight">
                            把想象画成<br/>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-600 to-accent-600">唯美的互动绘本</span>
                        </h2>
                        <p className="text-slate-500 text-sm leading-relaxed">
                            输入一个想法，AI 将为您绘制精美的竖屏插画，并编织一个引导孩子深度思考的故事。
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
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">艺术风格</label>
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

                        {/* Section: Story Generation Model */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">故事创作模型</label>
                            <select 
                                value={selectedGenModel}
                                onChange={(e) => setSelectedGenModel(e.target.value)}
                                className="w-full px-5 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none text-sm font-medium shadow-sm"
                            >
                                {AVAILABLE_GEN_MODELS.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-slate-400 ml-1">
                                {AVAILABLE_GEN_MODELS.find(m => m.id === selectedGenModel)?.desc}
                            </p>
                        </div>

                        {/* Section: TTS Settings (Model Only) */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">语音引擎</label>
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
                                <span className="material-symbols-outlined text-yellow-300">brush</span>
                            )}
                            {isLoading ? '正在绘制插图、编排故事...' : '开始造梦'}
                        </button>
                    </div>
                </div>
            </div>

            {/* 2. Visualizations Grid */}
            <div className="grid grid-cols-1 gap-8 lg:h-[500px]">
                {/* Story Graph - Now Full Width */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[500px] lg:h-auto">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 flex-none relative z-30">
                        <div className="flex gap-2">
                            {/* Story Selector Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => setIsSelectorOpen(!isSelectorOpen)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:text-brand-600 hover:border-brand-200 transition-all shadow-sm"
                                    title="切换当前编辑/预览的故事"
                                >
                                    <span className="material-symbols-outlined text-sm text-brand-500">folder_open</span>
                                    <span className="max-w-[100px] truncate">{previewStory ? previewStory.title : '选择故事'}</span>
                                    <span className="material-symbols-outlined text-[10px]">expand_more</span>
                                </button>
                                
                                {isSelectorOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10 cursor-default" onClick={() => setIsSelectorOpen(false)}></div>
                                        <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 z-20 py-2 max-h-72 overflow-y-auto custom-scrollbar animate-fade-in-up">
                                            <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 mb-1 border-b border-slate-50">
                                                本地故事库 ({localStories.length})
                                            </div>
                                            {localStories.length === 0 ? (
                                                <div className="px-4 py-3 text-xs text-slate-400 text-center">暂无故事</div>
                                            ) : (
                                                localStories.map(s => (
                                                    <button
                                                        key={s.id}
                                                        onClick={() => {
                                                            setPreviewStoryId(s.id);
                                                            setIsSelectorOpen(false);
                                                        }}
                                                        className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-brand-50 transition-colors ${previewStoryId === s.id ? 'text-brand-600 font-bold bg-brand-50/50' : 'text-slate-600'}`}
                                                    >
                                                        <span className="truncate flex-1">{s.title}</span>
                                                        {s.isOfflineReady && <span className="material-symbols-outlined text-[12px] text-green-500 ml-2" title="已就绪">check_circle</span>}
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="h-6 w-px bg-slate-200 mx-1"></div>

                            <button 
                                onClick={() => setViewMode('graph')}
                                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${viewMode === 'graph' ? 'bg-white shadow text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <span className="material-symbols-outlined text-sm">account_tree</span>
                                蓝图
                            </button>
                            <button 
                                onClick={() => setViewMode('preview')}
                                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${viewMode === 'preview' ? 'bg-white shadow text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <span className="material-symbols-outlined text-sm">visibility</span>
                                预览
                            </button>
                        </div>

                        {previewStory && (
                            <div className="flex items-center gap-2">
                                {/* New: Allow deleting drafts directly from preview */}
                                {!previewStory.isOfflineReady && (
                                    <button 
                                        onClick={(e) => handleDeleteClick(e, previewStory.id)}
                                        className={`
                                            flex items-center justify-center w-8 h-8 rounded-lg transition-all
                                            ${deleteConfirmId === previewStory.id 
                                                ? 'bg-red-500 text-white shadow-red-200 shadow-sm animate-pulse' 
                                                : 'bg-white text-slate-400 border border-slate-200 hover:text-red-500 hover:border-red-200'}
                                        `}
                                        title="删除草稿"
                                    >
                                        <span className="material-symbols-outlined text-sm">
                                            {deleteConfirmId === previewStory.id ? 'check' : 'delete'}
                                        </span>
                                    </button>
                                )}

                                <button
                                    onClick={() => handleDownload(previewStory)}
                                    disabled={downloadingId === previewStory.id || previewStory.isOfflineReady}
                                    className={`
                                        flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm
                                        ${previewStory.isOfflineReady 
                                            ? 'bg-green-50 text-green-600 border border-green-100 cursor-default' 
                                            : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95 shadow-brand-200'}
                                        ${downloadingId === previewStory.id ? 'opacity-80 cursor-wait' : ''}
                                    `}
                                >
                                    {downloadingId === previewStory.id ? (
                                        <>
                                            <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                                            生成中 {downloadProgress}%
                                        </>
                                    ) : previewStory.isOfflineReady ? (
                                        <>
                                            <span className="material-symbols-outlined text-sm">check_circle</span>
                                            绘本已就绪
                                        </>
                                    ) : (
                                        <>
                                            <span className="material-symbols-outlined text-sm">imagesmode</span>
                                            生成配图与配音
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 relative bg-slate-50 overflow-hidden">
                        {!previewStory ? (
                             <div className="flex items-center justify-center h-full text-slate-400">
                                 <p>暂无故事，请先创作一个吧！</p>
                             </div>
                        ) : viewMode === 'graph' ? (
                            <StoryGraph key={previewStory.id} nodes={previewStory.nodes} startNodeId="start" />
                        ) : (
                            <div className="absolute inset-0 p-8 overflow-y-auto custom-scrollbar">
                                <h3 className="text-xl font-bold text-slate-800 mb-4">{previewStory.title}</h3>
                                <div className="space-y-6">
                                    {getSortedNodes(previewStory).map((node, i) => (
                                        <div key={node.id} className="relative pl-8 border-l-2 border-slate-200 pb-6 last:pb-0 last:border-0">
                                            <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 bg-white ${node.type === 'choice' ? 'border-amber-400' : 'border-brand-400'}`}></div>
                                            <p className="text-sm text-slate-600 mb-2">{node.text}</p>
                                            {node.options && (
                                                <div className="flex gap-2">
                                                    {node.options.map(o => (
                                                        <span key={o.label} className="text-[10px] px-2 py-1 bg-slate-100 rounded text-slate-500 border border-slate-200">
                                                            {o.label}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 3. Story List */}
            <div className="space-y-4">
                 <h3 className="text-xl font-bold text-slate-800 px-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-brand-500">history_edu</span>
                    故事库 ({libraryStories.length})
                 </h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {libraryStories.map(story => (
                        <div 
                            key={story.id} 
                            onClick={() => setPreviewStoryId(story.id)}
                            className={`group relative bg-white rounded-2xl p-4 border-2 transition-all cursor-pointer hover:-translate-y-1 hover:shadow-xl ${previewStoryId === story.id ? 'border-brand-400 ring-4 ring-brand-50 shadow-lg' : 'border-transparent hover:border-brand-200 shadow-sm'}`}
                        >
                            <div className="flex gap-4">
                                <div className="w-20 h-20 rounded-xl bg-slate-100 overflow-hidden flex-none relative">
                                    <img src={story.cover} alt="Cover" className="w-full h-full object-cover" />
                                    {story.isOfflineReady && (
                                        <div className="absolute bottom-1 right-1 bg-green-500 text-white p-0.5 rounded-full" title="已缓存">
                                            <span className="material-symbols-outlined text-[10px] block">wifi_off</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start">
                                        <h4 className="font-bold text-slate-800 truncate pr-2">{story.title}</h4>
                                        <button 
                                            onClick={(e) => handleDeleteClick(e, story.id)}
                                            className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${deleteConfirmId === story.id ? 'bg-red-500 text-white animate-pulse' : 'text-slate-300 hover:bg-red-50 hover:text-red-500'}`}
                                            title="删除"
                                        >
                                            <span className="material-symbols-outlined text-sm">
                                                {deleteConfirmId === story.id ? 'check' : 'delete'}
                                            </span>
                                        </button>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{story.topic}</p>
                                    
                                    <div className="flex items-center gap-2 mt-3">
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${story.status === 'completed' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                            {story.status === 'completed' ? '已完成' : '草稿'}
                                        </span>
                                        <span className="text-xs text-slate-400 flex items-center gap-0.5">
                                            <span className="material-symbols-outlined text-[10px]">mic</span>
                                            {story.voice === 'Puck' ? '淘气包' : 
                                             story.voice === 'Kore' ? '温柔姐姐' : 
                                             story.voice === 'Charon' ? '老爷爷' : 
                                             story.voice === 'Fenrir' ? '探险家' : 
                                             story.voice === 'Zephyr' ? '小精灵' : 
                                             story.voice === 'Aoede' ? '百灵鸟' : 'AI推荐'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Action Buttons (Hover) */}
                            <div className="absolute bottom-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleDownload(story); }}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center border shadow-sm transition-colors ${story.isOfflineReady ? 'bg-green-50 text-green-600 border-green-200' : 'bg-white text-slate-400 border-slate-200 hover:text-brand-600 hover:border-brand-200'}`}
                                    title="生成配图与配音"
                                >
                                    {downloadingId === story.id ? (
                                        <span className="text-[10px] font-bold">{downloadProgress}%</span>
                                    ) : (
                                        <span className="material-symbols-outlined text-sm">
                                            {story.isOfflineReady ? 'check_circle' : 'imagesmode'}
                                        </span>
                                    )}
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleStartInteraction(story.id); }}
                                    className="w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center shadow-md hover:bg-brand-500 hover:scale-110 transition-all"
                                    title="开始播放"
                                >
                                    <span className="material-symbols-outlined text-sm">play_arrow</span>
                                </button>
                            </div>
                        </div>
                    ))}
                    {libraryStories.length === 0 && (
                        <div className="col-span-full py-8 text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
                            <p>暂无已完成的故事。请在上方生成故事并点击“生成配图与配音”以加入故事库。</p>
                        </div>
                    )}
                 </div>
            </div>
        </div>
    );
};
