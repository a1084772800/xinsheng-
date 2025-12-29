import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Story, StoryNode } from '../types';
import { AudioVisualizer } from './AudioVisualizer';
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
    const [feedbackText, setFeedbackText] = useState("正在读故事...");
    
    // Check if current node image is cached, otherwise use cover temporarily
    const [currentImage, setCurrentImage] = useState<string>(story.cover);
    
    // Model Switching State
    const [currentTtsModel, setCurrentTtsModel] = useState<string>(story.ttsModel || 'gemini-2.5-flash-preview-tts');
    const [showModelSwitcher, setShowModelSwitcher] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);

    // Ref to track current node ID for async operations (race condition prevention)
    const currentNodeIdRef = useRef(currentNodeId);
    // Ref to track interaction state to prevent stale closures in callbacks
    const interactionStateRef = useRef(interactionState);
    
    // NEW: Track ALL recognized speech for the CURRENT node context
    const speechHistoryRef = useRef<string[]>([]);

    // Update refs when state changes
    useEffect(() => {
        currentNodeIdRef.current = currentNodeId;
        // Reset speech history buffer when node changes
        speechHistoryRef.current = []; 
    }, [currentNodeId]);

    useEffect(() => {
        interactionStateRef.current = interactionState;
    }, [interactionState]);

    // Ensure node exists
    const currentNode = story.nodes[currentNodeId];

    // Helper to safely change node and cancel pending stuff
    const safeSetNode = (nextId: string) => {
        setCurrentNodeId(nextId);
        // Reset state immediately
        setInteractionState('reading');
    };

    const handleChoice = (index: number, explicitTranscript?: string) => {
        // Guard: Use the ref to ensure we are operating on the right node if called async
        const currentRefNode = story.nodes[currentNodeIdRef.current];
        if (!currentRefNode?.options) return;
        
        const choice = currentRefNode.options[index];
        if (!choice) return;

        // Pass both the specific triggering transcript AND the full history
        onChoiceMade(
            choice.label, 
            choice.type, 
            currentNodeIdRef.current, 
            explicitTranscript, 
            [...speechHistoryRef.current] // Pass a copy of the full history
        );
        
        if (story.nodes[choice.next]) {
            safeSetNode(choice.next);
        } else {
            console.warn(`Target node ${choice.next} does not exist. Ending story.`);
            onComplete();
        }
    };

    // --- Speech Recognition Handler ---
    const handleSpeechResult = useCallback((text: string) => {
        // Only update feedback if we have text, otherwise keep "Listening..."
        if (text) setFeedbackText(text);
    }, []);

    // Use the Web Speech API hook
    const startListeningRef = useRef<() => void>(() => {});

    const handleSpeechEnd = useCallback(async (finalText: string) => {
        const activeNodeId = currentNodeIdRef.current;
        const activeNode = story.nodes[activeNodeId];
        const currentInteractionState = interactionStateRef.current;

        // Guard: If we moved to another node while listening/processing, ignore
        if (!activeNode?.options || activeNode.type === 'linear') return;

        // 1. Clean Text
        const cleanText = finalText ? finalText.trim() : '';

        // Helper to restart listening smoothly
        const restartListening = (msg: string) => {
            if (currentInteractionState === 'listening') {
                setFeedbackText(msg);
                setTimeout(() => {
                    if (interactionStateRef.current === 'listening') {
                        startListeningRef.current(); 
                    }
                }, 800);
            }
        };

        // 2. Empty Input Check
        if (!cleanText) {
            // If no text captured (timeout or error) AND we are still in listening mode
            restartListening("没听清，再试一次...");
            return;
        }

        // --- FILTER LOGIC START ---
        
        // 3. Local Match Check (Highest Priority)
        // If it matches a keyword, we accept it regardless of length (e.g., "A", "是")
        const localMatchIndex = matchIntentLocally(cleanText, activeNode.options);
        const isLocalMatch = localMatchIndex !== null;

        // 4. Length/Noise Check
        // If it's NOT a direct local match, enforce stricter rules to avoid uploading noise
        if (!isLocalMatch) {
            // Remove punctuation for length check
            const textOnly = cleanText.replace(/[.,!?;:。，！？]/g, '');
            
            // Criteria: Must be at least 2 chars (e.g. "我想去") OR strictly alphabet (e.g. "A" if missed by local match)
            // This filters out single Chinese char noise like "啊", "额", "嗯"
            const isTooShort = textOnly.length < 2 && !/^[a-zA-Z]+$/.test(textOnly);
            
            if (isTooShort) {
                console.log("Input filtered (too short/noise):", cleanText);
                restartListening("请说得完整一点...");
                return;
            }
        }

        // --- FILTER LOGIC END ---

        // Valid input accepted
        // --- Append to history ---
        speechHistoryRef.current.push(cleanText);

        setInteractionState('processing');
        setFeedbackText("正在思考...");

        // --- HYBRID STRATEGY: STEP 1 - LOCAL MATCH (FAST) ---
        if (isLocalMatch && localMatchIndex !== null) {
            const choice = activeNode.options![localMatchIndex];
            setFeedbackText(`听到了！选 ${choice.label}`);
            
            // Short delay for user to see feedback
            setTimeout(() => {
                if (currentNodeIdRef.current === activeNodeId) {
                    handleChoice(localMatchIndex, cleanText);
                }
            }, 600);
            return;
        }

        // --- HYBRID STRATEGY: STEP 2 - API FALLBACK (SLOW) ---
        try {
            const result = await analyzeChildInput(
                activeNode.text + " " + (activeNode.question || ""),
                activeNode.options!,
                cleanText
            );

            // Check if user navigated away while we were awaiting
            if (currentNodeIdRef.current !== activeNodeId) return;

            if (result.action === 'SELECT_OPTION' && result.selectedOptionIndex !== undefined) {
                 const choice = activeNode.options![result.selectedOptionIndex];
                 if (choice) {
                     setFeedbackText(`听到了！选 ${choice.label}`);
                     setTimeout(() => {
                        if (currentNodeIdRef.current === activeNodeId) {
                            handleChoice(result.selectedOptionIndex!, cleanText);
                        }
                     }, 800);
                     return;
                 }
            } 
            
            // Fallback: Guide user
            setInteractionState('guiding');
            setFeedbackText("AI正在回应...");
            
            const reply = result.replyText || "你是想选哪个呢？";
            playTextToSpeech({
                text: reply, 
                voiceName: story.voice,
                model: currentTtsModel,
                onEnd: () => {
                    if (currentNodeIdRef.current === activeNodeId) {
                        // Automatically restart listening after guiding, IF we are still here
                        setInteractionState('listening'); // Reset state to ensure loop continues
                        startListeningRef.current(); 
                        setFeedbackText("请再说一次...");
                    }
                }
            });

        } catch (e) {
            console.error("Analysis failed", e);
            if (currentNodeIdRef.current === activeNodeId) {
                setFeedbackText("网络有点卡，请直接点击选项吧");
                setInteractionState('reading');
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [story.nodes, story.voice, currentTtsModel]); // Depend on stable things

    const { isListening, transcript, startListening, stopListening, abortListening } = useSpeechRecognition({
        onResult: handleSpeechResult,
        onEnd: handleSpeechEnd,
        // Increased from 1500 to 3000 to allow children more time to pause/think without cutting off
        silenceDuration: 3000 
    });

    // Update the ref so handleSpeechEnd can call it
    useEffect(() => {
        startListeningRef.current = startListening;
    }, [startListening]);
    
    // --- Image & Audio Generation Effect ---
    useEffect(() => {
        if (!currentNode) return;
        
        let isMounted = true;
        
        // Use a stable key for caching: storyId + nodeId
        const cacheKey = `${story.id}_${currentNode.id}`;

        if (currentNode.imagePrompt) {
            generateSceneImage(currentNode.imagePrompt, cacheKey).then(img => {
                if (!isMounted) return;
                
                if (img) {
                    setCurrentImage(img);
                    
                    // CRITICAL: If this is the start node and we just got an image, 
                    // and the current story cover is still the placeholder, update it!
                    if (currentNode.id === 'start' && onStoryUpdate) {
                        // Check if cover is the default picsum one (approximate check) or different from new img
                        if (story.cover !== img) {
                            const updatedStory = { ...story, cover: img };
                            onStoryUpdate(updatedStory);
                        }
                    }
                }
            });
        }
        
        // FIXED: Force prefetch current node audio immediately to trigger DB->Memory decode
        // This ensures audio is ready by the time the visual effect finishes or image loads
        const currentSpeech = constructNodeSpeech(currentNode);
        prefetchAudio(currentSpeech, story.voice, currentTtsModel);

        // OPTIMIZATION: Prefetch images AND AUDIO for connected nodes
        // We delay this slightly (3s) to prioritize the current node's TTS/Image loading first
        const prefetchTimer = setTimeout(() => {
            if (isMounted) {
                // Handle linear flow
                if (currentNode.type === 'linear' && currentNode.next) {
                    const nextNode = story.nodes[currentNode.next];
                    if (nextNode) {
                        const nextText = constructNodeSpeech(nextNode);
                        prefetchAudio(nextText, story.voice, currentTtsModel);
                        if (nextNode.imagePrompt) {
                             const nextKey = `${story.id}_${nextNode.id}`;
                             generateSceneImage(nextNode.imagePrompt, nextKey).catch(() => {});
                        }
                    }
                }
                // Handle choice flow
                else if (currentNode.type === 'choice' && currentNode.options) {
                    currentNode.options.forEach(opt => {
                         const nextNode = story.nodes[opt.next];
                         if (nextNode) {
                             if (nextNode.imagePrompt) {
                                 const nextKey = `${story.id}_${nextNode.id}`;
                                 generateSceneImage(nextNode.imagePrompt, nextKey).catch(() => {});
                             }
                             const nextText = constructNodeSpeech(nextNode);
                             prefetchAudio(nextText, story.voice, currentTtsModel);
                         }
                    });
                }
            }
        }, 3000);

        return () => { 
            isMounted = false; 
            clearTimeout(prefetchTimer);
        };
    }, [currentNodeId, currentNode, story.id, story.voice, currentTtsModel]); 

    // --- TTS Playback Logic ---
    const speakCurrentNode = useCallback(() => {
        if (!currentNode) return;

        // Reset State for New Node
        setInteractionState('reading');
        abortListening(); 
        stopAudio();
        setFeedbackText("正在讲故事...");

        const textToRead = constructNodeSpeech(currentNode);

        playTextToSpeech({
            text: textToRead, 
            voiceName: story.voice, 
            model: currentTtsModel,
            // Trigger this when audio definitely finishes
            onEnd: () => {
                if (currentNodeIdRef.current !== currentNode.id) return; // Guard

                if (currentNode.type === 'end') {
                    setFeedbackText("故事结束啦");
                    setTimeout(() => {
                        onComplete();
                    }, 3000); 
                } 
                else if (currentNode.type === 'linear') {
                    // AUTO-ADVANCE LOGIC
                    setFeedbackText("继续讲下去...");
                    setInteractionState('waiting');
                    if (currentNode.next && story.nodes[currentNode.next]) {
                         setTimeout(() => {
                             if (currentNodeIdRef.current === currentNode.id) {
                                 safeSetNode(currentNode.next!);
                             }
                         }, 1200); // 1.2s gap for linear nodes
                    } else {
                        // Fallback if linear node has no next (should be 'end' type, but just in case)
                         setTimeout(() => {
                             onComplete();
                         }, 3000);
                    }
                }
                else if (currentNode.type === 'choice') {
                    // Turn-Taking Gap: Wait before opening mic to avoid cutting off prompt
                    setInteractionState('waiting');
                    setFeedbackText("说完后再听你说...");
                    
                    setTimeout(() => {
                         if (currentNodeIdRef.current !== currentNode.id) return;
                         setInteractionState('listening');
                         startListening();
                         setFeedbackText("请告诉我你的决定...");
                    }, 600); // 600ms gap
                }
            },
            onError: (error) => {
                if (error instanceof QuotaExhaustedError || error.message === 'API_QUOTA_EXHAUSTED' || error.message?.includes('429')) {
                    setShowModelSwitcher(true);
                    return true; // Stop default fallback behavior
                }
                return false; // Allow fallback for other errors
            }
        });
    }, [currentNode, story.voice, currentTtsModel, startListening, onComplete, abortListening]);

    // --- Main Story Flow Effect ---
    useEffect(() => {
        if (!currentNode) {
            console.error("Node not found:", currentNodeId);
            setFeedbackText("故事遇到了一点小问题...");
            setTimeout(onExit, 2000);
            return;
        }
        
        speakCurrentNode();

        return () => {
            stopAudio();
            abortListening();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentNodeId, currentTtsModel]); // Trigger re-read if model changes (retry)

    // Retry handler for Model Switcher
    const handleModelSwitch = (newModelId: string) => {
        setCurrentTtsModel(newModelId);
        setShowModelSwitcher(false);
        setIsRetrying(true);
        // The useEffect will trigger re-read because currentTtsModel changed
        setTimeout(() => setIsRetrying(false), 500);
    };

    // Manual manual interaction handling
    const onMicClick = () => {
        if (interactionState === 'listening') {
            if (transcript && transcript.trim().length > 0) {
                stopListening(); 
            } else {
                abortListening(); 
                setInteractionState('reading'); 
                setFeedbackText("已暂停，点击继续");
            }
        } else if (interactionState === 'processing') {
            abortListening();
            setInteractionState('reading');
            setFeedbackText("已取消，请点击选项");
        } else if (interactionState === 'waiting') {
             // User impatient? Let them skip gap
             setInteractionState('listening');
             startListening();
             setFeedbackText("我在听...");
        } else {
            setInteractionState('listening');
            startListening();
            setFeedbackText("我在听...");
        }
    };

    if (!currentNode) {
        return (
            <div className="flex items-center justify-center h-full bg-[#fff1f2] flex-col gap-4">
                <span className="material-symbols-outlined text-4xl text-slate-400">broken_image</span>
                <p className="text-slate-500 font-bold">剧情加载中断</p>
                <button onClick={onExit} className="px-6 py-2 bg-white rounded-full shadow text-brand-600 font-bold">返回</button>
            </div>
        );
    }

    const getStatusColor = () => {
        switch(interactionState) {
            case 'listening': 
                return isListening
                    ? 'text-green-600 bg-green-50 border-green-200 ring-2 ring-green-100 shadow-md' 
                    : 'text-orange-600 bg-orange-50 border-orange-200';
            case 'waiting': return 'text-slate-500 bg-slate-50 border-slate-200 cursor-wait';
            case 'processing': return 'text-brand-600 bg-brand-50 border-brand-200 animate-pulse';
            case 'guiding': return 'text-purple-600 bg-purple-50 border-purple-200';
            default: return 'text-slate-500 bg-slate-100 border-slate-200 hover:bg-white';
        }
    };

    const getStatusIcon = () => {
        switch(interactionState) {
            case 'listening': return isListening ? 'mic' : 'mic_none';
            case 'waiting': return 'hourglass_empty';
            case 'processing': return 'hourglass_top';
            case 'guiding': return 'record_voice_over';
            default: return 'mic_none'; 
        }
    };

    const getStatusLabel = () => {
         if (interactionState === 'processing') return '思考中 (点击取消)';
         if (interactionState === 'waiting') return '请稍等...';
         if (interactionState === 'listening' && !isListening) return '准备中...';
         if (interactionState === 'listening' && isListening) return transcript || "我在听...";
         return feedbackText;
    };

    return (
        <section className="absolute inset-0 bg-[#fff1f2] overflow-hidden">
            {/* Background Layer */}
            <div className="absolute inset-0 z-0">
                <img 
                    src={currentImage} 
                    alt="Background" 
                    className="w-full h-full object-cover opacity-30 transition-all duration-1000 transform scale-105 blur-sm" 
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#fff1f2] via-transparent to-transparent"></div>
            </div>

            {/* Scrollable Container */}
            <div className="absolute inset-0 z-10 overflow-y-auto overflow-x-hidden custom-scrollbar">
                <div className="w-full min-h-full max-w-4xl mx-auto px-6 py-10 flex flex-col items-center justify-between">
                    
                    {/* Visualizer / Character */}
                    <div className="flex-1 flex items-center justify-center w-full relative min-h-[300px] my-6">
                        <div className="relative w-64 h-64 md:w-80 md:h-80 group">
                            
                            {/* Listening Animation */}
                            {interactionState === 'listening' && isListening && (
                                <>
                                    <div className="absolute inset-0 rounded-full border-4 border-green-400 opacity-60 animate-ping"></div>
                                    <div className="absolute inset-0 rounded-full border-2 border-green-300 opacity-40 animate-pulse scale-110"></div>
                                </>
                            )}

                            {interactionState === 'processing' && (
                                <div className="absolute inset-0 rounded-full border-4 border-brand-400 animate-spin border-t-transparent"></div>
                            )}

                            {interactionState === 'waiting' && (
                                <div className="absolute inset-0 rounded-full border-4 border-slate-200 animate-pulse"></div>
                            )}
                            
                            <img 
                                src={currentImage}
                                alt="Scene" 
                                className="w-full h-full object-cover rounded-full border-8 border-white shadow-2xl relative z-10 transition-all duration-500" 
                            />
                            
                            {(interactionState === 'reading' || interactionState === 'guiding') && (
                                <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-white px-5 py-2 rounded-full shadow-lg flex gap-1.5 items-center whitespace-nowrap">
                                    <AudioVisualizer isActive={true} />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Text & Interactions */}
                    <div className="w-full flex flex-col items-center pb-8">
                        {/* Display Narrative TEXT */}
                        <div className="bg-white/90 backdrop-blur-sm p-6 rounded-3xl shadow-lg border border-white mb-8 max-w-3xl mx-4 text-center">
                            <p className="text-xl md:text-2xl text-slate-800 leading-relaxed mb-4">
                                {currentNode.text}
                            </p>
                            {currentNode.type === 'choice' && currentNode.question && (
                                <p className="text-lg md:text-xl font-bold text-brand-600">
                                    {currentNode.question}
                                </p>
                            )}
                        </div>

                        {/* Interaction Status Bar */}
                        <button 
                            onClick={onMicClick}
                            disabled={interactionState === 'waiting' || currentNode.type === 'linear'}
                            className={`flex items-center gap-2 mb-8 px-5 py-2.5 rounded-full text-sm md:text-base font-bold shadow-sm transition-all duration-300 border active:scale-95 ${getStatusColor()} ${interactionState === 'waiting' || currentNode.type === 'linear' ? 'opacity-80' : ''}`}
                        >
                            {currentNode.type === 'linear' ? (
                                <>
                                    <div className="w-6 h-6 rounded-full flex items-center justify-center bg-slate-100">
                                        <span className="material-symbols-outlined text-lg text-slate-400">hourglass_bottom</span>
                                    </div>
                                    <span>自动播放中...</span>
                                </>
                            ) : (
                                <>
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${interactionState === 'listening' && isListening ? 'animate-pulse' : ''}`}>
                                        <span className="material-symbols-outlined text-lg">{getStatusIcon()}</span>
                                    </div>
                                    <span className="truncate max-w-[240px] md:max-w-none">{getStatusLabel()}</span>
                                </>
                            )}
                        </button>

                        {/* Choices - ONLY Show if type is 'choice' */}
                        {currentNode.type === 'choice' && currentNode.options && (
                            <div className={`flex flex-col md:flex-row gap-6 w-full px-4 transition-opacity duration-500 ${interactionState === 'reading' || interactionState === 'waiting' ? 'opacity-50 hover:opacity-100' : 'opacity-100'}`}>
                                {currentNode.options.map((opt, idx) => (
                                    <button 
                                        key={idx}
                                        onClick={() => handleChoice(idx)}
                                        className="flex-1 bg-white hover:bg-brand-50 border-2 border-brand-200 hover:border-brand-500 p-6 rounded-3xl shadow-lg hover:shadow-xl transition-all group text-left relative overflow-hidden transform hover:-translate-y-1 active:scale-95"
                                    >
                                        <span className="block text-brand-600 font-bold text-2xl mb-1 text-center">{opt.label}</span>
                                        {opt.label !== opt.text && (
                                            <span className="text-slate-400 text-xs font-bold block text-center line-clamp-1">"{opt.text}"</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <button 
                className="absolute top-6 right-6 p-3 bg-white/60 hover:bg-white rounded-full text-slate-500 hover:text-slate-800 transition-all z-20 backdrop-blur shadow-sm" 
                onClick={() => { stopAudio(); abortListening(); onExit(); }}
            >
                <span className="material-symbols-outlined text-2xl">close</span>
            </button>

            {/* Model Switcher Dialog (PORTAL) */}
            {showModelSwitcher && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden animate-scale-up shadow-2xl">
                        <div className="bg-amber-50 p-6 text-center border-b border-amber-100">
                            <span className="material-symbols-outlined text-4xl text-amber-500 mb-2">speed</span>
                            <h3 className="text-xl font-bold text-slate-800">模型响应繁忙</h3>
                            <p className="text-sm text-slate-500 mt-1">当前语音模型额度已用完，请切换其他模型继续收听。</p>
                        </div>
                        <div className="p-4 space-y-2 max-h-[300px] overflow-y-auto">
                            {AVAILABLE_TTS_MODELS.map(model => (
                                <button
                                    key={model.id}
                                    onClick={() => handleModelSwitch(model.id)}
                                    className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                                        currentTtsModel === model.id 
                                            ? 'bg-amber-50 border-amber-300 ring-1 ring-amber-200' 
                                            : 'bg-white border-slate-200 hover:border-brand-300 hover:bg-slate-50'
                                    }`}
                                >
                                    <div>
                                        <div className="font-bold text-sm text-slate-800">{model.name}</div>
                                        <div className="text-[10px] text-slate-400">{model.desc}</div>
                                    </div>
                                    {currentTtsModel === model.id && (
                                        <span className="material-symbols-outlined text-amber-500">check_circle</span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100">
                            <button 
                                onClick={() => setShowModelSwitcher(false)}
                                className="w-full py-3 text-slate-500 font-bold text-sm hover:text-slate-700"
                            >
                                暂时不听了 (退出)
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isRetrying && (
                <div className="absolute inset-0 z-40 bg-white/50 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-white px-6 py-3 rounded-full shadow-lg flex items-center gap-3">
                        <span className="material-symbols-outlined animate-spin text-brand-500">sync</span>
                        <span className="font-bold text-slate-600">正在切换并重试...</span>
                    </div>
                </div>
            )}
        </section>
    );
};