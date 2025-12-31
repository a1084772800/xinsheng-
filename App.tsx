
import React, { useState, useEffect } from 'react';
import { ParentDashboard } from './components/ParentDashboard';
import { StoryPlayer } from './components/StoryPlayer';
import { ChildLibrary } from './components/ChildLibrary';
import { backgroundCacheHighPriority } from './services/geminiService';
import { storageService } from './services/storageService';
import { Story, UserChoice } from './types';
import { INITIAL_STORY } from './constants';

const App: React.FC = () => {
    // API Key State
    const [isApiKeySet, setIsApiKeySet] = useState<boolean | null>(null);

    const [mode, setMode] = useState<'parent' | 'kid'>('parent');
    const [stories, setStories] = useState<Story[]>([INITIAL_STORY]);
    const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false); // Controls Player vs Library view in Kid mode
    const [choices, setChoices] = useState<UserChoice[]>([]);
    
    // Feature 0: Check API Key (Environment Specific)
    useEffect(() => {
        const checkKey = async () => {
            if ((window as any).aistudio && (window as any).aistudio.hasSelectedApiKey) {
                const has = await (window as any).aistudio.hasSelectedApiKey();
                setIsApiKeySet(has);
            } else {
                // If not in the specific aistudio environment, assume environment variables are handled differently
                // or we are in local dev where process.env is set.
                setIsApiKeySet(true);
            }
        };
        checkKey();
    }, []);

    const handleSelectKey = async () => {
        if ((window as any).aistudio?.openSelectKey) {
            await (window as any).aistudio.openSelectKey();
            // Race condition mitigation: Assume success immediately
            setIsApiKeySet(true);
        }
    };

    // Feature 1: Pre-request Microphone Permission on Mount
    useEffect(() => {
        const requestMic = async () => {
            try {
                // Determine if we already have permission
                const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
                if (status.state === 'prompt' || status.state === 'granted') {
                    // Open stream briefly to trigger prompt or warm up system, then close immediately
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach(track => track.stop());
                }
            } catch (e) {
                console.warn("Pre-check microphone permission failed:", e);
            }
        };
        requestMic();
    }, []);

    // Feature 2: Initial Load & Default Story Persistence & Silent Caching
    useEffect(() => {
        const loadStoriesFromDB = async () => {
            try {
                const dbStories = await storageService.getAllStories();
                let activeStories = [];
                if (dbStories && dbStories.length > 0) {
                    activeStories = dbStories;
                } else {
                    // Database is empty, save the default story so it doesn't disappear later
                    await storageService.saveStory(INITIAL_STORY);
                    activeStories = [INITIAL_STORY];
                }
                setStories(activeStories);

                // --- SILENT CACHE TRIGGER ---
                // Automatically cache the start node and first branches of the most recent story
                // to reduce wait time when the user clicks play.
                if (activeStories.length > 0) {
                    // Stories are sorted by date desc in storageService, so [0] is latest
                    const latestStory = activeStories[0];
                    backgroundCacheHighPriority(latestStory);
                }

            } catch (e) {
                console.error("Failed to load stories from DB:", e);
            }
        };
        loadStoriesFromDB();
    }, []);

    const handleStoryGenerated = (story: Story) => {
        setStories([story, ...stories]);
    };

    // New: Handle updates to a story (e.g. cover image updated, cached status changed)
    const handleStoryUpdate = (updatedStory: Story) => {
        setStories(prev => prev.map(s => s.id === updatedStory.id ? updatedStory : s));
        storageService.saveStory(updatedStory); // Ensure persistence in DB
    };
    
    // NEW: Handle story deletion to sync across Parent/Child views
    const handleStoryDelete = (storyId: string) => {
        setStories(prev => prev.filter(s => s.id !== storyId));
    };

    // Called when clicking "Play" from Parent Dashboard
    const handlePlayStory = (storyId: string) => {
        setCurrentStoryId(storyId);
        setChoices([]);
        setMode('kid');
        setIsPlaying(true); // Jump directly to player
    };

    // Called when clicking a card in Child Library
    const handleChildLibraryPlay = (storyId: string) => {
        setCurrentStoryId(storyId);
        setChoices([]);
        setIsPlaying(true);
    };

    const handleChoiceMade = (selection: string, type: string, step: string, transcript?: string, speechHistory?: string[]) => {
        setChoices(prev => [...prev, { step, selection, type, transcript, speechHistory }]);
    };

    const handleStoryComplete = async () => {
        if (!currentStoryId) return;
        
        setMode('parent'); // Switch back to parent view
        setIsPlaying(false); // Reset player state
    };

    const currentStory = stories.find(s => s.id === currentStoryId);

    // --- RENDER API KEY BLOCKING SCREEN ---
    if (isApiKeySet === false) {
        return (
            <div className="fixed inset-0 z-[200] bg-slate-50 flex items-center justify-center p-4">
                <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full text-center border border-slate-100">
                    <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-accent-500 rounded-2xl mx-auto flex items-center justify-center text-white shadow-lg mb-6">
                        <span className="material-symbols-outlined text-3xl">key</span>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">需要配置 API Key</h2>
                    <p className="text-slate-500 mb-8 leading-relaxed">
                        心声故事需要使用 Gemini API 来生成精彩的互动剧情。请先连接您的 Google Cloud API Key。
                    </p>
                    
                    <button 
                        onClick={handleSelectKey}
                        className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold text-lg hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                        <span className="material-symbols-outlined">link</span>
                        连接 API Key
                    </button>
                    
                    <div className="mt-6 text-xs text-slate-400">
                        <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">
                            了解关于 Gemini API 的计费信息
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    if (isApiKeySet === null) {
        return null; // Loading state
    }

    // --- FIX: Use 100dvh for WeChat compatibility and add safe-area padding ---
    return (
        <div className="h-screen supports-[height:100dvh]:h-[100dvh] w-full flex flex-col bg-slate-50 overflow-hidden">
            {/* Navbar */}
            <nav className="bg-white/90 backdrop-blur-md border-b border-slate-200 z-50 flex-none shadow-sm pt-[env(safe-area-inset-top)]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-white shadow-lg">
                                <span className="material-symbols-outlined">record_voice_over</span>
                            </div>
                            <div>
                                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-brand-600 to-accent-600 tracking-tight">心声故事</h1>
                                <p className="text-[10px] text-slate-500 font-medium tracking-wider uppercase">Heart-Voice Stories</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 md:gap-4">
                            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                                <button 
                                    className={`px-3 md:px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${mode === 'parent' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    onClick={() => setMode('parent')}
                                >
                                    家长端
                                </button>
                                <button 
                                    className={`px-3 md:px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${mode === 'kid' ? 'bg-white text-accent-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    onClick={() => {
                                        setMode('kid');
                                        setIsPlaying(false); // Show library by default
                                    }}
                                >
                                    儿童端
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Main Content with Safe Area Bottom Padding */}
            <main className="flex-1 relative w-full pb-[env(safe-area-inset-bottom)]">
                {mode === 'parent' ? (
                    <div className="absolute inset-0 overflow-y-auto p-4 lg:p-8 animate-fade-in custom-scrollbar">
                        <ParentDashboard 
                            stories={stories} 
                            onStoryGenerated={handleStoryGenerated} 
                            onPlayStory={handlePlayStory} 
                            onStoryUpdate={handleStoryUpdate}
                            onStoryDelete={handleStoryDelete}
                        />
                    </div>
                ) : (
                    <div className="absolute inset-0 animate-slide-in-right bg-white overflow-hidden">
                        {isPlaying && currentStory ? (
                            <StoryPlayer 
                                story={currentStory} 
                                onExit={() => setIsPlaying(false)} // Return to library
                                onComplete={handleStoryComplete}
                                onChoiceMade={handleChoiceMade} 
                                onStoryUpdate={handleStoryUpdate}
                            />
                        ) : (
                            <ChildLibrary 
                                stories={stories} 
                                onPlay={handleChildLibraryPlay} 
                            />
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

export default App;
