import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Story, StoryNode } from '../types';
import { playTextToSpeech, stopAudio, generateSceneImage, analyzeChildInput, constructNodeSpeech, matchIntentLocally, QuotaExhaustedError, AVAILABLE_TTS_MODELS, prefetchAudio } from '../services/geminiService';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

interface StoryPlayerProps {
    story: Story;
    onExit: () => void;
    onComplete: () => void;
    onChoiceMade: (choice: string, type: string, step: string, transcript?: string, speechHistory?: string[]) => void;
    onStoryUpdate?: (story: Story) => void;
}

type InteractionState = 'reading' | 'waiting' | 'listening' | 'processing' | 'guiding';

export const StoryPlayer: React.FC<StoryPlayerProps> = ({ story, onExit, onComplete, onChoiceMade, onStoryUpdate }) => {
    
    const [currentNodeId, setCurrentNodeId] = useState('start');
    const [interactionState, setInteractionState] = useState<InteractionState>('reading');
    const [feedbackText, setFeedbackText] = useState("");
    
    // Navigation History for "Back" functionality
    const [history, setHistory] = useState<string[]>([]);

    // Images
    const [currentImage, setCurrentImage] = useState<string>(story.cover);
    const [bgImageLayer1, setBgImageLayer1] = useState<string>(story.cover);
    const [bgImageLayer2, setBgImageLayer2] = useState<string>('');
    const [activeBgLayer, setActiveBgLayer] = useState<1 | 2>(1);

    // Controls visibility
    const [userInteracted, setUserInteracted] = useState(false);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    // Model Switching
    const [currentTtsModel, setCurrentTtsModel] = useState<string>(story.ttsModel || 'gemini-2.5-flash-preview-tts');
    const [showModelSwitcher, setShowModelSwitcher] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);

    // Refs
    const currentNodeIdRef = useRef(currentNodeId);
    const interactionStateRef = useRef(interactionState);
    const speechHistoryRef = useRef<string[]>([]);
    const retryCountRef = useRef(0); 
    const containerRef = useRef<HTMLDivElement>(null);

    // Ensure node exists
    const currentNode = story.nodes[currentNodeId];

    // --- Interaction Timer (Auto-hide controls) ---
    const resetInteractionTimer = useCallback(() => {
        setUserInteracted(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            setUserInteracted(false);
        }, 4000);
    }, []);

    useEffect(() => {
        const handleActivity = () => resetInteractionTimer();
        window.addEventListener('touchstart', handleActivity);
        window.addEventListener('click', handleActivity);
        resetInteractionTimer(); // Init
        return () => {
            window.removeEventListener('touchstart', handleActivity);
            window.removeEventListener('click', handleActivity);
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        };
    }, [resetInteractionTimer]);


    useEffect(() => {
        currentNodeIdRef.current = currentNodeId;
        speechHistoryRef.current = []; 
        retryCountRef.current = 0; 
    }, [currentNodeId]);

    useEffect(() => {
        interactionStateRef.current = interactionState;
    }, [interactionState]);

    // --- Helper: Safe State Transitions ---
    const safeSetNode = (nextId: string) => {
        if (!story.nodes[nextId]) {
            console.warn(`Target node ${nextId} missing, ending story.`);
            onComplete();
            return;
        }
        setHistory(prev => [...prev, currentNodeId]); // Add current to history before moving
        setCurrentNodeId(nextId);
        setInteractionState('reading');
    };

    const handleBack = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (history.length === 0) return;
        
        const prevId = history[history.length - 1];
        setHistory(prev => prev.slice(0, -1));
        setCurrentNodeId(prevId);
        setInteractionState('reading');
        stopAudio();
        abortListening();
    };

    const handleChoice = (index: number, explicitTranscript?: string) => {
        const currentRefNode = story.nodes[currentNodeIdRef.current];
        if (!currentRefNode?.options) return;
        
        const choice = currentRefNode.options[index];
        if (!choice) return;

        // Feedback Audio before transition
        setFeedbackText(`"${choice.label}"`);
        setInteractionState('guiding');
        
        playTextToSpeech({
            text: `好的！${choice.text || choice.label}`,
            voiceName: story.voice,
            model: currentTtsModel,
            onEnd: () => {
                 onChoiceMade(
                    choice.label, 
                    choice.type, 
                    currentNodeIdRef.current, 
                    explicitTranscript, 
                    [...speechHistoryRef.current]
                );
                safeSetNode(choice.next);
            }
        });
    };

    const speakSystemPrompt = (text: string, onComplete: () => void) => {
        setFeedbackText(text);
        playTextToSpeech({
            text,
            voiceName: story.voice,
            model: currentTtsModel,
            onEnd: onComplete
        });
    };

    // --- Speech Recognition Logic ---
    const handleSpeechResult = useCallback((text: string) => {
        if (text) setFeedbackText(`"${text}"`);
    }, []);

    const startListeningRef = useRef<() => void>(() => {});

    const handleSpeechEnd = useCallback(async (finalText: string) => {
        const activeNodeId = currentNodeIdRef.current;
        const activeNode = story.nodes[activeNodeId];

        if (!activeNode?.options || activeNode.type === 'linear') return;

        const cleanText = finalText ? finalText.trim() : '';

        if (!cleanText) {
            if (retryCountRef.current < 2) {
                setInteractionState('guiding');
                retryCountRef.current += 1;
                speakSystemPrompt("还在吗？请告诉我你想选哪一个。", () => {
                     if (currentNodeIdRef.current === activeNodeId) {
                         setInteractionState('listening');
                         startListeningRef.current();
                     }
                });
            } else {
                setInteractionState('waiting');
                setFeedbackText("请直接点击选项哦");
            }
            return;
        }

        speechHistoryRef.current.push(cleanText);
        setInteractionState('processing');
        setFeedbackText("正在思考...");

        const localMatchIndex = matchIntentLocally(cleanText, activeNode.options);
        if (localMatchIndex !== null) {
            if (currentNodeIdRef.current === activeNodeId) {
                handleChoice(localMatchIndex, cleanText);
            }
            return;
        }

        try {
            const result = await analyzeChildInput(
                activeNode.text + " " + (activeNode.question || ""),
                activeNode.options!,
                cleanText
            );

            if (currentNodeIdRef.current !== activeNodeId) return;

            if (result.action === 'SELECT_OPTION' && result.selectedOptionIndex !== undefined) {
                 handleChoice(result.selectedOptionIndex!, cleanText);
                 return;
            } 
            
            setInteractionState('guiding');
            retryCountRef.current += 1;
            
            const reply = result.replyText || "你是想选哪个呢？可以再说一次吗？";
            speakSystemPrompt(reply, () => {
                if (currentNodeIdRef.current === activeNodeId) {
                    setInteractionState('listening'); 
                    startListeningRef.current(); 
                    setFeedbackText("请再说一次...");
                }
            });

        } catch (e) {
            console.error("Analysis failed", e);
            setFeedbackText("网络有点卡，请直接点击选项吧");
            setInteractionState('reading');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [story.nodes, story.voice, currentTtsModel]); 

    const { isListening, isSupported: isMicSupported, startListening, stopListening, abortListening } = useSpeechRecognition({
        onResult: handleSpeechResult,
        onEnd: handleSpeechEnd,
        silenceDuration: 2500 
    });

    useEffect(() => {
        startListeningRef.current = startListening;
    }, [startListening]);
    
    // --- Asset Management ---
    useEffect(() => {
        if (!currentNode) return;
        
        let isMounted = true;
        const cacheKey = `${story.id}_${currentNode.id}`;

        const updateBg = (newImg: string) => {
            setCurrentImage(prev => {
                if (prev === newImg) return prev;
                if (activeBgLayer === 1) {
                    setBgImageLayer2(newImg);
                    setActiveBgLayer(2);
                } else {
                    setBgImageLayer1(newImg);
                    setActiveBgLayer(1);
                }
                return newImg;
            });
        };

        if (currentNode.imagePrompt) {
            generateSceneImage(currentNode.imagePrompt, cacheKey).then(img => {
                if (!isMounted) return;
                if (img) {
                    updateBg(img);
                    if (currentNode.id === 'start' && onStoryUpdate && story.cover !== img) {
                        onStoryUpdate({ ...story, cover: img });
                    }
                }
            });
        }
        
        const currentSpeech = constructNodeSpeech(currentNode);
        prefetchAudio(currentSpeech, story.voice, currentTtsModel);

        const prefetchTimer = setTimeout(() => {
            if (isMounted) {
                const nodesToPrefetch = [];
                if (currentNode.type === 'linear' && currentNode.next) {
                    nodesToPrefetch.push(story.nodes[currentNode.next]);
                } else if (currentNode.type === 'choice' && currentNode.options) {
                    currentNode.options.forEach(opt => nodesToPrefetch.push(story.nodes[opt.next]));
                }
                nodesToPrefetch.forEach(node => {
                    if (node) {
                        prefetchAudio(constructNodeSpeech(node), story.voice, currentTtsModel);
                        if (node.imagePrompt) {
                            generateSceneImage(node.imagePrompt, `${story.id}_${node.id}`).catch(()=>{});
                        }
                    }
                });
            }
        }, 1500); 

        return () => { 
            isMounted = false; 
            clearTimeout(prefetchTimer);
        };
    }, [currentNodeId, currentNode, story.id, story.voice, currentTtsModel]); 

    // --- Main Story Flow ---
    const speakCurrentNode = useCallback(() => {
        if (!currentNode) return;

        setInteractionState('reading');
        abortListening(); 
        stopAudio();
        
        const textToRead = constructNodeSpeech(currentNode);
        setFeedbackText(""); 

        playTextToSpeech({
            text: textToRead, 
            voiceName: story.voice, 
            model: currentTtsModel,
            onEnd: () => {
                if (currentNodeIdRef.current !== currentNode.id) return; 

                if (currentNode.type === 'end') {
                    setFeedbackText("✨ 故事结束 ✨");
                    setTimeout(onComplete, 4000); 
                } 
                else if (currentNode.type === 'linear') {
                    if (currentNode.next && story.nodes[currentNode.next]) {
                         setTimeout(() => {
                             if (currentNodeIdRef.current === currentNode.id) {
                                 safeSetNode(currentNode.next!);
                             }
                         }, 800); 
                    } else {
                         setTimeout(onComplete, 3000);
                    }
                }
                else if (currentNode.type === 'choice') {
                    if (isMicSupported) {
                         setInteractionState('listening');
                         // setFeedbackText("请做出选择...");
                         setTimeout(() => {
                             if (currentNodeIdRef.current === currentNode.id) {
                                 startListening();
                             }
                         }, 100);
                    } else {
                        setInteractionState('waiting');
                        setFeedbackText("请点击屏幕选项");
                    }
                }
            },
            onError: (error) => {
                if (error instanceof QuotaExhaustedError) {
                    setShowModelSwitcher(true);
                    return true;
                }
                return false;
            }
        });
    }, [currentNode, story.voice, currentTtsModel, startListening, onComplete, abortListening, isMicSupported]);

    useEffect(() => {
        if (!currentNode) {
            setTimeout(onExit, 2000);
            return;
        }
        speakCurrentNode();
        return () => {
            stopAudio();
            abortListening();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentNodeId, currentTtsModel]); 

    const handleReplay = (e: React.MouseEvent) => {
        e.stopPropagation();
        speakCurrentNode();
    };

    const handleModelSwitch = (newModelId: string) => {
        setCurrentTtsModel(newModelId);
        setShowModelSwitcher(false);
        setIsRetrying(true);
        setTimeout(() => setIsRetrying(false), 500);
    };

    if (!currentNode) return null;

    // --- UI RENDER ---
    const showChoices = currentNode.type === 'choice' && currentNode.options;
    const isInteractive = ['listening', 'waiting', 'guiding', 'processing'].includes(interactionState);
    const showBubbles = ['listening', 'waiting', 'guiding'].includes(interactionState);

    return createPortal(
        <section ref={containerRef} className="fixed inset-0 bg-black overflow-hidden font-sans select-none z-[100] text-white">
            
            {/* 1. Cinematic Background (Ken Burns) */}
            <div className="absolute inset-0 z-0 bg-black">
                {[bgImageLayer1, bgImageLayer2].map((img, idx) => {
                    const isActive = (idx === 0 && activeBgLayer === 1) || (idx === 1 && activeBgLayer === 2);
                    return (
                        <div 
                            key={idx}
                            className={`absolute inset-0 bg-cover bg-center transition-opacity duration-[1500ms] ease-in-out ${isActive ? 'opacity-100' : 'opacity-0'}`}
                            style={{ backgroundImage: `url(${img})` }}
                        >
                             <div className={`absolute inset-0 bg-inherit bg-cover bg-center ${isActive ? 'animate-ken-burns' : ''}`}></div>
                        </div>
                    );
                })}
                {/* Cinematic Vignette - Darker at bottom for text readability */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent via-50% to-black/90 pointer-events-none"></div>
            </div>

            {/* 2. Top Controls (Auto-hide) */}
            <div className={`absolute top-0 left-0 right-0 z-50 p-6 flex justify-between items-start transition-all duration-500 ${userInteracted || showChoices ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
                <button 
                    onClick={(e) => { e.stopPropagation(); stopAudio(); abortListening(); onExit(); }} 
                    className="glass-btn w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/20 transition-all backdrop-blur-md active:scale-90"
                    title="退出故事"
                >
                    <span className="material-symbols-outlined text-xl">close</span>
                </button>
                
                <div className="flex gap-3">
                     <button 
                         onClick={handleReplay}
                         className={`glass-btn w-10 h-10 rounded-full flex items-center justify-center transition-all backdrop-blur-md active:scale-90 ${interactionState === 'reading' ? 'bg-white/20 text-white' : 'text-white/70'}`}
                         title="重播本页"
                     >
                        <span className="material-symbols-outlined text-xl">replay</span>
                     </button>
                </div>
            </div>

            {/* 3. Immersive Listening Stage */}
            <div className={`absolute inset-0 z-20 flex flex-col items-center justify-center transition-all duration-700 ${isInteractive ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {/* ... Magic Orb and Feedback ... */}
                <div className="relative mb-6">
                    <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 ${interactionState === 'listening' ? 'w-80 h-80 animate-[ping_3s_infinite] opacity-30' : 'w-0 h-0 opacity-0'}`}></div>
                    <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/20 blur-3xl ${interactionState === 'listening' ? 'w-64 h-64 animate-pulse' : 'w-0 h-0'}`}></div>
                    
                    <div 
                        className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500 backdrop-blur-md border border-white/20 shadow-[0_0_40px_rgba(255,255,255,0.2)] 
                        ${interactionState === 'listening' ? 'bg-gradient-to-b from-brand-400/30 to-brand-600/10 scale-110 shadow-[0_0_60px_rgba(14,165,233,0.6)] border-brand-300/50' : 'bg-gradient-to-b from-white/10 to-white/5 scale-100'}`}
                        onClick={() => { if(interactionState === 'waiting') startListening(); }}
                    >
                         <span className={`material-symbols-outlined text-5xl drop-shadow-lg transition-colors ${interactionState === 'waiting' ? 'text-white/50' : 'text-white/80'} ${interactionState === 'processing' ? 'animate-spin' : ''}`}>
                             {interactionState === 'processing' ? 'hourglass_top' : (interactionState === 'waiting' ? 'touch_app' : 'mic')}
                         </span>
                    </div>

                    {feedbackText && (
                        <div className="absolute top-36 left-1/2 -translate-x-1/2 w-[280px] text-center z-50">
                            <span className="inline-block px-4 py-2 rounded-2xl bg-black/60 backdrop-blur-md border border-white/10 text-white/90 text-sm font-bold shadow-lg animate-fade-in-up whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                                {feedbackText}
                            </span>
                        </div>
                    )}
                </div>

                {/* Choice Suggestions */}
                {showChoices && (
                    <div className={`mt-12 w-full max-w-lg px-6 flex flex-wrap items-center justify-center gap-3 transition-all duration-500 ${showBubbles ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
                        <div className="w-full text-center mb-1">
                             <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">您可以说...</span>
                        </div>
                        {currentNode.options!.map((opt, idx) => (
                            <button
                                key={idx}
                                onClick={(e) => { e.stopPropagation(); handleChoice(idx); }}
                                className="glass-btn relative flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 transform active:scale-95 hover:bg-white/20 border border-white/10"
                                style={{ transitionDelay: `${idx * 50}ms` }}
                            >
                                <span className="text-sm font-medium text-white/90 drop-shadow-sm">{opt.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* 4. Bottom Text Container */}
            <div className={`absolute bottom-0 left-0 right-0 z-10 pb-safe flex flex-col items-center justify-end min-h-[30vh] transition-opacity duration-500 ${isInteractive ? 'opacity-40' : 'opacity-100'}`}>
                 <div className="w-full bg-gradient-to-t from-black via-black/80 to-transparent pt-24 pb-8 px-8 md:px-16 text-center">
                     <p className="text-xl md:text-3xl font-medium leading-relaxed tracking-wide text-white/95 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] font-sans">
                         {currentNode.text}
                     </p>
                 </div>
            </div>

            {/* --- Explicit Side Navigation Buttons (Replaces Hidden Zones) --- */}
            
            {/* Previous Page Button (Left) */}
            {history.length > 0 && (
                <button 
                    onClick={handleBack}
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-40 w-12 h-12 rounded-full glass-btn flex items-center justify-center text-white hover:bg-white/20 transition-all active:scale-90 shadow-lg border border-white/20 backdrop-blur-md"
                    title="上一页"
                >
                    <span className="material-symbols-outlined text-3xl">chevron_left</span>
                </button>
            )}

            {/* Next Page Button (Right) - Only for linear pages */}
            {currentNode.type === 'linear' && (
                <button 
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        stopAudio(); 
                        if(currentNode.next) safeSetNode(currentNode.next); 
                        else onComplete(); 
                    }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-40 w-12 h-12 rounded-full glass-btn flex items-center justify-center text-white hover:bg-white/20 transition-all active:scale-90 shadow-lg border border-white/20 backdrop-blur-md animate-pulse-slow"
                    title="下一页"
                >
                    <span className="material-symbols-outlined text-3xl">chevron_right</span>
                </button>
            )}

            {/* Model Switcher Modal */}
            {showModelSwitcher && createPortal(
                <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden p-6 text-center shadow-2xl animate-scale-up">
                        <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-outlined">cloud_sync</span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">切换语音模型</h3>
                        <p className="text-slate-500 text-sm mb-6">当前配额已耗尽，请选择备用方案</p>
                        <div className="space-y-3">
                        {AVAILABLE_TTS_MODELS.map(model => (
                            <button key={model.id} onClick={() => handleModelSwitch(model.id)} className={`w-full p-4 rounded-xl border text-left text-sm font-bold flex items-center justify-between transition-all ${currentTtsModel === model.id ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
                                <span>{model.name}</span>
                                {currentTtsModel === model.id && <span className="material-symbols-outlined">check</span>}
                            </button>
                        ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}
            
            {/* Loading Overlay */}
            {isRetrying && (
                <div className="absolute inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center text-white gap-3">
                    <span className="material-symbols-outlined animate-spin text-3xl">sync</span>
                    <span className="font-bold tracking-widest">正在连接...</span>
                </div>
            )}

            <style>{`
                @keyframes ken-burns {
                    0% { transform: scale(1.0); }
                    100% { transform: scale(1.15); }
                }
                .animate-ken-burns {
                    animation: ken-burns 20s infinite alternate cubic-bezier(0.4, 0, 0.2, 1);
                }
                .p-safe {
                    padding-top: env(safe-area-inset-top);
                    padding-left: env(safe-area-inset-left);
                    padding-right: env(safe-area-inset-right);
                }
                .pb-safe {
                    padding-bottom: env(safe-area-inset-bottom);
                }
            `}</style>
        </section>,
        document.body
    );
};