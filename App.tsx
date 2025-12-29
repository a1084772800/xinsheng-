
import React, { useState, useEffect } from 'react';
import { ParentDashboard } from './components/ParentDashboard';
import { StoryPlayer } from './components/StoryPlayer';
import { ChildLibrary } from './components/ChildLibrary';
import { ReportView } from './components/ReportView';
import { generateParentingReport, backgroundCacheHighPriority } from './services/geminiService';
import { storageService } from './services/storageService';
import { Story, UserChoice, UserStats, ReportData } from './types';

// Mock Data for Initial State (Updated with new traits)
const INITIAL_STORY: Story = {
    id: 'demo_xian_adventure',
    title: "壮壮的西安奇幻历险记",
    topic: "文化探索",
    goal: "creativity",
    voice: "Puck", 
    style: "Adventure",
    date: new Date().toISOString().split('T')[0],
    status: "completed",
    cover: "https://picsum.photos/seed/xian_terracotta_warrior/400/400",
    tags: ["西安", "兵马俑", "历史", "奇幻"],
    nodes: {
        start: {
            id: 'start',
            text: "壮壮来到了西安的兵马俑博物馆。这里有好几千个陶土做的士兵，整整齐齐地站着，看起来威风极了！突然，壮壮发现最前排的一个将军俑眨了眨眼睛，好像在对他招手呢！",
            audioText: "壮壮来到了西安的兵马俑博物馆。这里有好几千个陶土做的士兵，整整齐齐地站着，看起来威风极了！突然，壮壮发现最前排的一个将军俑眨了眨眼睛，好像在对他招手呢！",
            imagePrompt: "Terracotta Warriors museum Xi'an china cartoon style magical glowing general winking at little boy",
            type: "choice",
            question: "壮壮应该怎么办呢？",
            options: [
                { label: "跟过去", text: "我要去看看他在干什么！", keywords: ["去", "跟", "看"], next: "node_follow_general", type: "independence" },
                { label: "告诉妈妈", text: "妈妈，那个兵马俑动了！", keywords: ["妈妈", "怕", "告诉"], next: "node_tell_mom", type: "confidence" }
            ]
        },
        node_follow_general: {
            id: 'node_follow_general',
            text: "壮壮趁大人不注意，悄悄溜到了栏杆旁边。将军俑竟然开口说话了，声音像敲钟一样洪亮：“小朋友，我的青铜宝剑不见了，你能帮我找找吗？”",
            imagePrompt: "Underground magical tunnel ancient china cartoon style terracotta general talking to little boy close up",
            type: "choice",
            question: "要帮将军找宝剑吗？",
            options: [
                { label: "帮忙找", text: "别担心，我帮你找！", keywords: ["帮", "找", "好"], next: "node_find_sword", type: "social" },
                { label: "问问题", text: "你是怎么活过来的呀？", keywords: ["问", "活", "怎么"], next: "node_ask_magic", type: "creativity" }
            ]
        },
        node_find_sword: {
            id: 'node_find_sword',
            text: "壮壮在角落里发现了一闪一闪的光芒，原来是一只贪吃的小老鼠偷走了宝剑，正准备用来切肉夹馍呢！壮壮赶跑了老鼠，拿回了宝剑。将军俑送给他一枚秦朝的古钱币作为感谢。",
            imagePrompt: "Cartoon mouse holding ancient bronze sword trying to cut a roujiamo chinese burger",
            type: "end"
        },
        node_ask_magic: {
            id: 'node_ask_magic',
            text: "将军俑哈哈大笑：“因为你充满了想象力呀！只要相信奇迹，历史就会活过来。”说完，他化作一道金光，带着壮壮飞上了大雁塔的顶端，俯瞰整个西安美丽的夜景。",
            imagePrompt: "Flying over Giant Wild Goose Pagoda Xi'an night view magical golden light fantasy style",
            type: "end"
        },
        node_tell_mom: {
            id: 'node_tell_mom',
            text: "妈妈笑着摸了摸壮壮的头：“傻孩子，那是灯光晃眼看错了吧？是不是肚子饿了？走，妈妈带你去回民街吃好吃的！”",
            imagePrompt: "Mom comforting boy in museum cartoon style warm lighting",
            type: "linear",
            next: "node_food_street"
        },
        node_food_street: {
            id: 'node_food_street',
            text: "回民街真热闹呀！到处都是香喷喷的味道。壮壮大口吃着羊肉泡馍，心想：虽然没去探险，但西安的美食也像魔法一样让人开心！",
            imagePrompt: "Xi'an Muslim Quarter street food market bustling cartoon style boy eating soup bowl",
            type: "end"
        }
    }
};

const App: React.FC = () => {
    // API Key State
    const [isApiKeySet, setIsApiKeySet] = useState<boolean | null>(null);

    const [mode, setMode] = useState<'parent' | 'kid'>('parent');
    const [stories, setStories] = useState<Story[]>([INITIAL_STORY]);
    const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false); // Controls Player vs Library view in Kid mode
    const [choices, setChoices] = useState<UserChoice[]>([]);
    
    // Stats State (Updated Keys)
    const [userStats, setUserStats] = useState<UserStats>({
        confidence: 0,
        social: 0,
        logic: 0,
        resilience: 0,
        independence: 0,
        creativity: 0
    });
    // Track the changes from the LAST session to display animations
    const [statDeltas, setStatDeltas] = useState<Partial<UserStats>>({});

    // Report State
    const [showReport, setShowReport] = useState(false);
    const [reportData, setReportData] = useState<ReportData | null>(null);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);

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
        setShowReport(false);
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
        
        setIsGeneratingReport(true);
        setMode('parent'); // Switch back to parent view to show report
        setIsPlaying(false); // Reset player state

        const story = stories.find(s => s.id === currentStoryId);
        const title = story?.title || "未知故事";
        
        // 1. Generate Report via AI
        const report = await generateParentingReport(title, choices);
        
        // 2. Precise Mapping: Update Stats based on AI Delta values
        const newDeltas: Partial<UserStats> = {};
        const newStats = { ...userStats };

        report.dimensions.forEach(dim => {
            const subject = dim.subject; 
            const delta = dim.delta || 0; 
            
            // Robust Fuzzy Matching for Mapping Keys to new 6 Dimensions
            let key = '';
            if (subject.match(/Confidence|Security|Safe|Sure/i)) key = 'confidence';
            else if (subject.match(/Social|Empathy|Kind|Love/i)) key = 'social';
            else if (subject.match(/Logic|Think|Honest|Reason/i)) key = 'logic';
            else if (subject.match(/Resilience|Brave|Courage|Grit/i)) key = 'resilience';
            else if (subject.match(/Independence|Self|Solo/i)) key = 'independence';
            else if (subject.match(/Creativity|Create|Imagine|Dream/i)) key = 'creativity';

            if (key && delta !== 0) {
                // Apply delta directly, clamping between 0 and 100
                newStats[key] = Math.max(0, Math.min(100, (newStats[key] || 0) + delta));
                newDeltas[key] = delta;
            }
        });

        setUserStats(newStats);
        setStatDeltas(newDeltas);
        
        setReportData(report);
        setShowReport(true);
        setIsGeneratingReport(false);
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

    return (
        <div className="h-screen w-full flex flex-col bg-slate-50">
            {/* Navbar */}
            <nav className="bg-white/90 backdrop-blur-md border-b border-slate-200 z-50 flex-none shadow-sm">
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

            {/* Main Content */}
            <main className="flex-1 relative overflow-hidden w-full">
                {mode === 'parent' ? (
                    <div className="absolute inset-0 overflow-y-auto p-4 lg:p-8 animate-fade-in">
                        {isGeneratingReport && (
                             <div className="absolute inset-0 z-40 bg-white/80 backdrop-blur flex items-center justify-center flex-col">
                                <span className="material-symbols-outlined text-4xl animate-spin text-brand-500 mb-2">sync</span>
                                <p className="text-slate-600 font-bold">正在分析孩子心理...</p>
                             </div>
                        )}
                        <ParentDashboard 
                            stories={stories} 
                            userStats={userStats}
                            statDeltas={statDeltas}
                            lastReport={reportData}
                            onStoryGenerated={handleStoryGenerated} 
                            onPlayStory={handlePlayStory} 
                            onStoryUpdate={handleStoryUpdate}
                            onStoryDelete={handleStoryDelete}
                        />
                        {showReport && reportData && (
                            <ReportView report={reportData} onClose={() => setShowReport(false)} />
                        )}
                    </div>
                ) : (
                    <div className="absolute inset-0 animate-slide-in-right bg-white">
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
