
import { GoogleGenAI, Modality, Type, Schema, GenerateContentResponse } from "@google/genai";
import { Story, StoryNode } from "../types";
import { decode, decodeAudioData } from "./audioUtils";
import { storageService } from "./storageService";
import { errorBus } from "./errorBus"; 

// Export available models for UI usage
export const AVAILABLE_TTS_MODELS = [
    { id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash TTS', desc: '⚡️ 极速·最快 (推荐)' },
    { id: 'browser-tts', name: '本地浏览器语音', desc: '🚀 本地·零延迟 (系统默认)' },
];

// Available Story Generation Models
export const AVAILABLE_GEN_MODELS = [
    { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash', desc: '🚀 最新·智能均衡 (推荐)' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro', desc: '🧠 深度推理·复杂剧情' },
];

// Export available voices (Cloud) - Kept for labels in story cards
export const AVAILABLE_VOICES = [
    { id: 'Kore', name: 'Kore', label: '温柔姐姐 (Kore)', desc: '云端·治愈', type: 'cloud', gender: 'female' },
    { id: 'Puck', name: 'Puck', label: '淘气包 (Puck)', desc: '云端·冒险', type: 'cloud', gender: 'male' },
    { id: 'Charon', name: 'Charon', label: '老爷爷 (Charon)', desc: '云端·深沉', type: 'cloud', gender: 'male' },
    { id: 'Fenrir', name: 'Fenrir', label: '探险家 (Fenrir)', desc: '云端·悬疑', type: 'cloud', gender: 'male' },
    { id: 'Zephyr', name: 'Zephyr', label: '小精灵 (Zephyr)', desc: '云端·童话', type: 'cloud', gender: 'female' },
    { id: 'Aoede', name: 'Aoede', label: '百灵鸟 (Aoede)', desc: '云端·科普', type: 'cloud', gender: 'female' },
];

const getAI = async () => {
    const key = process.env.API_KEY;
    if (!key) throw new Error("API Key is missing. Please set it in the environment or via the settings.");
    
    const options: any = { apiKey: key };
    
    return new GoogleGenAI(options);
};

export class QuotaExhaustedError extends Error {
    constructor() {
        super("API_QUOTA_EXHAUSTED");
        this.name = "QuotaExhaustedError";
    }
}

async function withRetry<T>(operation: (ai: GoogleGenAI) => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> {
    try {
        const ai = await getAI();
        return await operation(ai);
    } catch (error: any) {
        const isQuotaError = error.status === 429 || error.code === 429 || (error.message && error.message.includes('429'));
        const isLimitZero = error.message && (
            error.message.includes('limit: 0') || 
            error.message.includes('Quota exceeded')
        );

        if (isLimitZero) {
            errorBus.emit({
                level: 'error', 
                title: '配额耗尽',
                message: 'API 调用次数已达今日上限。',
                details: error
            });
            throw new QuotaExhaustedError();
        }
        
        if (isQuotaError && retries > 0) {
            if (retries === 3) {
                errorBus.emit({ level: 'warning', message: '服务器繁忙，正在重试...', title: 'Retrying' });
            }
            const delay = baseDelay * Math.pow(2, 3 - retries); 
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(operation, retries - 1, baseDelay);
        }
        throw error;
    }
}

class RateLimiter {
    private queue: (() => Promise<void>)[] = [];
    private processing = false;
    private gap = 1500; 

    add(task: () => Promise<void>) {
        this.queue.push(task);
        this.process();
    }

    clear() {
        this.queue = [];
        this.processing = false;
    }

    private async process() {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                try {
                    await task();
                } catch (e: any) {
                    // Suppress
                }
            }
            
            if (this.queue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, this.gap));
            }
        }

        this.processing = false;
    }
}

const backgroundQueue = new RateLimiter();


// --- Helper: Text Construction ---
export const constructNodeSpeech = (node: StoryNode): string => {
    if (!node) return "";
    
    let textToRead = node.audioText || node.text || "";
    
    // Safety check for API error leaks or empty content
    if (!textToRead || textToRead.includes("Unexpected error") || textToRead.includes("Finish what you were doing")) {
        return "请看屏幕继续。";
    }

    const ensurePunctuation = (text: string, defaultPunct = "。") => {
        const trimmed = text.trim();
        if (!trimmed) return "";
        const lastChar = trimmed.slice(-1);
        if (!['。', '！', '？', '.', '!', '?'].includes(lastChar)) {
            return trimmed + defaultPunct;
        }
        return trimmed;
    };

    textToRead = ensurePunctuation(textToRead);
    
    if (node.type === 'choice') {
        if (node.question && !textToRead.includes(node.question)) {
            textToRead += ` ${node.question}`;
        }
        
        textToRead = ensurePunctuation(textToRead, "？");

        if (node.options && node.options.length > 0) {
            // Enhanced Natural Prompt for "Heart-Voice"
            const labels = node.options.map(opt => opt.label);
            textToRead += ` 比如说：${labels.join('，或者 ')}。`;
        }
    }
    return textToRead.trim();
};

// --- Audio / TTS System ---

let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let masterGain: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let activeRequestId = 0; 

export const initializeAudio = async () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // --- AUDIO PIPELINE SETUP ---
        // Source -> Compressor -> Master Gain -> Destination
        // This pipeline ensures we can boost low-volume TTS audio significantly 
        // without causing distortion on loud peaks.
        
        compressor = audioContext.createDynamicsCompressor();
        compressor.threshold.value = -20; // Start compressing early
        compressor.knee.value = 30; // Soft knee for natural sound
        compressor.ratio.value = 12; // High ratio to act as a limiter for peaks
        compressor.attack.value = 0.003; // Fast attack to catch transients
        compressor.release.value = 0.25; 

        masterGain = audioContext.createGain();
        masterGain.gain.value = 3.5; // BOOST VOLUME: 350% (Compensates for low PCM levels)

        compressor.connect(masterGain);
        masterGain.connect(audioContext.destination);
    }
    
    const unlock = async () => {
        if (audioContext && audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
            } catch (e) {
                console.warn("Audio resume failed", e);
            }
        }
        try {
            const buffer = audioContext.createBuffer(1, 1, 22050);
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start(0);
        } catch(e) {}
        
        // Trigger voice loading early for browser-tts
        if (window.speechSynthesis) {
            window.speechSynthesis.getVoices();
        }

        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('touchend', unlock);
    };

    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    document.addEventListener('touchend', unlock);
    document.addEventListener("WeixinJSBridgeReady", unlock, false);
    unlock();
};

export const stopAudio = () => {
    activeRequestId++;
    if (currentSource) {
        try {
            currentSource.stop();
            currentSource.disconnect();
        } catch (e) {}
        currentSource = null;
    }
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
};

const getAudioContext = async () => {
    if (!audioContext) {
        await initializeAudio();
    }
    if (audioContext && audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
        } catch(e) {}
    }
    return audioContext!;
};

const memoryCache = new Map<string, Promise<AudioBuffer>>();

const stringHash = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
};

const getCacheKey = (text: string, voice: string, model: string = 'default') => 
    `${model}:${voice}:${stringHash(text)}`;

const sanitizeModel = (model: string | undefined): string => {
    if (!model) return 'gemini-2.5-flash-preview-tts'; 
    const isValidModel = AVAILABLE_TTS_MODELS.some(m => m.id === model);
    if (isValidModel) return model;

    // Smart fallback for deprecated or unmatched models
    if (model === 'gemini-2.5-flash') return 'gemini-2.5-flash-preview-tts';
    if (model && (model.includes('latest') || model.includes('flash-lite'))) {
        return 'gemini-2.5-flash-preview-tts';
    }
    return 'gemini-2.5-flash-preview-tts'; // Default to recommended
};

export const prefetchAudio = (text: string, voice: string, rawModel: string = 'browser-tts') => {
    if (!text) return;
    if (rawModel === 'browser-tts') return;
    const isLocalVoice = !AVAILABLE_VOICES.some(v => v.id === voice);
    if (isLocalVoice) return; 

    const model = sanitizeModel(rawModel);
    const key = getCacheKey(text, voice, model);
    
    if (memoryCache.has(key)) return;

    const promise = new Promise<AudioBuffer>(async (resolve, reject) => {
        try {
            const dbData = await storageService.getAudio(key);
            if (dbData) {
                const ctx = await getAudioContext();
                const buffer = await decodeAudioData(new Uint8Array(dbData), ctx, 24000, 1);
                resolve(buffer);
                return;
            }

            backgroundQueue.add(async () => {
                try {
                    const existsNow = await storageService.getAudio(key);
                    if (existsNow) {
                        const ctx = await getAudioContext();
                        const buffer = await decodeAudioData(new Uint8Array(existsNow), ctx, 24000, 1);
                        resolve(buffer);
                        return;
                    }

                    const response = await withRetry(ai => ai.models.generateContent({
                        model: model,
                        contents: [{ parts: [{ text }] }],
                        config: {
                            responseModalities: [Modality.AUDIO],
                            speechConfig: {
                                voiceConfig: {
                                    prebuiltVoiceConfig: { voiceName: voice },
                                },
                            },
                        },
                    })) as GenerateContentResponse;

                    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                    if (!base64Audio) throw new Error("No audio data");
                    
                    const audioBytes = decode(base64Audio);
                    await storageService.saveAudio(key, audioBytes.buffer);
                    const ctx = await getAudioContext();
                    const buffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
                    resolve(buffer);
                } catch (e) {
                    memoryCache.delete(key);
                    reject(e);
                }
            });
        } catch (e) {
             memoryCache.delete(key);
             reject(e);
        }
    });

    promise.catch(() => {}); 
    memoryCache.set(key, promise);
};

export const backgroundCacheHighPriority = async (story: Story) => {
    if (story.isOfflineReady) return;
    
    const model = sanitizeModel(story.ttsModel);
    if (model === 'browser-tts' || !AVAILABLE_VOICES.some(v => v.id === story.voice)) {
        return;
    }

    const startNode = story.nodes['start'];
    if (startNode) {
        const startText = constructNodeSpeech(startNode);
        prefetchAudio(startText, story.voice, model);
        if (startNode.imagePrompt) {
            const imgKey = `${story.id}_start`;
            storageService.hasImage(imgKey).then(exists => {
                if (!exists) generateSceneImage(startNode.imagePrompt, imgKey).catch(()=>{});
            });
        }
    }

    const queueNextNodes = (node: StoryNode) => {
        if (!node) return;
        
        if (node.type === 'linear' && node.next) {
            const nextNode = story.nodes[node.next];
            if (nextNode) {
                 prefetchAudio(constructNodeSpeech(nextNode), story.voice, model);
                 if (nextNode.imagePrompt) {
                     const nextImgKey = `${story.id}_${nextNode.id}`;
                     storageService.hasImage(nextImgKey).then(exists => {
                         if (!exists) generateSceneImage(nextNode.imagePrompt, nextImgKey).catch(()=>{});
                     });
                 }
            }
        } else if (node.type === 'choice' && node.options) {
             node.options.forEach(opt => {
                 const nextNode = story.nodes[opt.next];
                 if (nextNode) {
                     prefetchAudio(constructNodeSpeech(nextNode), story.voice, model);
                     if (nextNode.imagePrompt) {
                         const nextImgKey = `${story.id}_${nextNode.id}`;
                         storageService.hasImage(nextImgKey).then(exists => {
                             if (!exists) generateSceneImage(nextNode.imagePrompt, nextImgKey).catch(()=>{});
                         });
                     }
                 }
             });
        }
    };
    
    queueNextNodes(startNode);
};

export const playTextToSpeech = async (params: {
    text: string;
    voiceName: string;
    model?: string;
    onEnd?: () => void;
    onError?: (e: any) => boolean; 
}) => {
    const { text, voiceName, onEnd, onError } = params;
    
    if (!text) {
        if (onEnd) onEnd();
        return;
    }

    const isLocalVoice = !AVAILABLE_VOICES.some(v => v.id === voiceName);
    const model = sanitizeModel(params.model);

    if (model === 'browser-tts' || isLocalVoice) {
        stopAudio();
        // Reverted to simple standard browser behavior as requested
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        
        utterance.onend = () => { if (onEnd) onEnd(); };
        utterance.onerror = (e) => {
             console.error("Local TTS Error", e);
             if (onError) onError(e);
             else if (onEnd) onEnd();
        };
        window.speechSynthesis.speak(utterance);
        return;
    }

    activeRequestId++;
    const currentRequestId = activeRequestId;

    try {
        const ctx = await getAudioContext();
        const key = getCacheKey(text, voiceName, model);

        let buffer: AudioBuffer | undefined;

        if (memoryCache.has(key)) {
            try { buffer = await memoryCache.get(key); } catch(e) { memoryCache.delete(key); }
        }

        if (!buffer) {
             const dbData = await storageService.getAudio(key);
             if (dbData) {
                 buffer = await decodeAudioData(new Uint8Array(dbData), ctx, 24000, 1);
                 memoryCache.set(key, Promise.resolve(buffer));
             }
        }

        if (!buffer) {
            const ai = await getAI();
            const response = await withRetry(ai => ai.models.generateContent({
                model: model,
                contents: [{ parts: [{ text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceName },
                        },
                    },
                },
            })) as GenerateContentResponse;

            if (currentRequestId !== activeRequestId) return; 

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) throw new Error("No audio data returned");
            
            const audioBytes = decode(base64Audio);
            storageService.saveAudio(key, audioBytes.buffer).catch(console.error);
            buffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
            memoryCache.set(key, Promise.resolve(buffer));
        }

        if (currentRequestId !== activeRequestId) return; 
        stopAudio();

        const source = ctx.createBufferSource();
        source.buffer = buffer!;
        
        // Connect to the Pipeline: Source -> Compressor -> Gain -> Destination
        // If pipeline isn't ready (fallback), connect to destination
        if (compressor) {
            source.connect(compressor);
        } else {
            source.connect(ctx.destination);
        }

        source.onended = () => {
            currentSource = null;
            if (onEnd) onEnd();
        };
        source.start(0);
        currentSource = source;

    } catch (e) {
        console.error("Audio playback error", e);
        if (onError && onError(e)) return;
        if (onEnd) onEnd();
    }
};

// --- Story Generation Logic (THE DREAMWEAVER) ---

export const generateStoryScript = async (
    prompt: string, 
    style: string, 
    voice: string,
    protagonist: string,
    ttsModel: string,
    genModel: string // ADDED: Model selection for story generation
): Promise<Story> => {
    const ai = await getAI();
    
    // Schema definition updated for World-Class Picture Book Structure
    const storySchema: Schema = {
        type: Type.OBJECT,
        properties: {
            title: { type: Type.STRING },
            topic: { type: Type.STRING },
            // NEW: AI Suggests a Voice Persona
            suggestedVoice: { 
                type: Type.STRING, 
                enum: ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr', 'Aoede'],
                description: "Select the best voice persona for this story. 'Kore': Gentle/Motherly, 'Puck': Naughty/Energetic Boy, 'Charon': Old/Storyteller, 'Zephyr': Cute/Childlike Girl, 'Fenrir': Deep/Mysterious." 
            },
            styleInstructions: { 
                type: Type.STRING, 
                description: "GLOBAL STYLE GUIDE: Define the aesthetic, color palette, lighting, and mood (e.g., 'Watercolor, Studio Ghibli inspired, soft pastel colors, warm lighting'). This string governs the visual consistency." 
            },
            nodeList: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        type: { type: Type.STRING, enum: ['choice', 'linear', 'end'] },
                        narrativeGoal: { type: Type.STRING, description: "NARRATIVE GOAL: The storytelling purpose. Can be 'Setup', 'Conflict', 'Interaction', 'Climax', 'Resolution'." },
                        text: { type: Type.STRING, description: "KEY CONTENT: The story narration text in CHINESE (e.g., '从前...'). Simple, rhythmic, suitable for reading aloud." },
                        visual: { type: Type.STRING, description: "VISUAL: Detailed visual description of the scene characters, action, and emotion in ENGLISH." },
                        layout: { type: Type.STRING, description: "LAYOUT: Composition advice for a 9:16 vertical phone screen (e.g., 'Subject at bottom, vast sky above', 'Close-up on face')." },
                        sceneDescriptionEN: { type: Type.STRING, description: "Legacy field for compatibility: Combine Visual + Layout into one prompt." },
                        question: { type: Type.STRING, description: "Optional question for interactive nodes." },
                        next: { type: Type.STRING },
                        options: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    label: { type: Type.STRING },
                                    text: { type: Type.STRING },
                                    next: { type: Type.STRING }
                                }
                            }
                        }
                    },
                    required: ['id', 'text', 'type', 'visual', 'layout']
                }
            }
        },
        required: ['title', 'styleInstructions', 'nodeList']
    };

    const systemPrompt = `
    You are **The Dreamweaver** (造梦师), a world-class children's picture book author.
    
    **MISSION**:
    Create a heartwarming, interactive picture book designed specifically for **9:16 vertical mobile screens**.
    Your output must be visually imaginative, narratively touching, and perfectly suited for children (ages 6-10).

    **STRUCTURAL BLUEPRINTS (CRITICAL - Choose One Randomly)**:
    Structure your story using ONE of these patterns to ensure variety. Do NOT create a simple straight line.
    
    1. **The "Trio" (3-Way Choice)**: 
       - At the main conflict, offer 3 distinct approaches (e.g., Brave, Clever, Kind).
       - Each option leads to a unique reaction scene before resolving.
    
    2. **The "Diamond" (Merge)**: 
       - Start -> Choice -> Divergent Paths (Nodes A / B) -> Merge back to a single powerful Climax -> End.
       - Use this to show different perspectives on the same event.
    
    3. **The "Interactive Action"**: 
       - Include a linear node that demands physical action (simulated).
       - Node 1 text: "Oh no, the clouds are dark! Can you blow on the screen to blow them away?" (Type: linear).
       - Node 2 text: "Wow! You did it! The sun is coming out." (Type: linear).
    
    **CORE DIRECTIVES**:
    - **Length**: Generate **6 to 10 nodes**. Do not make it too short.
    - **Visual Storytelling**: Every page must have a distinct visual focus.
    - **Child Psychology**: Use warm, encouraging language. 
    - **Voice Selection**: Choose a 'suggestedVoice' that matches the protagonist and tone.

    **INPUT**:
    - Protagonist: ${protagonist}
    - Topic: ${prompt}
    - Style Preference: ${style}
    `;

    try {
        const response = await withRetry(ai => ai.models.generateContent({
            model: genModel,
            contents: systemPrompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: storySchema,
                temperature: 1, 
            }
        })) as GenerateContentResponse;

        const rawJson = JSON.parse(response.text || '{}');
        const nodeMap: Record<string, StoryNode> = {};
        
        // Post-Processing: Construct the Full Image Prompts using Dreamweaver logic
        const globalStyle = rawJson.styleInstructions || `${style} style, beautiful children's book illustration`;
        
        // Use suggested voice if input voice is 'auto' or empty
        const finalVoice = (voice === 'auto' || !voice) ? (rawJson.suggestedVoice || 'Kore') : voice;

        if (rawJson.nodeList) {
            rawJson.nodeList.forEach((n: any) => {
                // Combine elements for the final image generator prompt
                // Logic: Global Style + Specific Visual Scene + Layout Constraint + Technical Quality
                const baseVisual = n.visual || n.sceneDescriptionEN || "A beautiful scene";
                const layout = n.layout || "Vertical composition, space for text";
                
                const fullImagePrompt = `
                    Style: ${globalStyle}.
                    Scene: ${baseVisual}.
                    Composition: ${layout}.
                    Format: Vertical 9:16 aspect ratio.
                    Quality: Masterpiece, high resolution, soft lighting, detailed texture.
                `.trim().replace(/\s+/g, ' ');
                
                nodeMap[n.id] = {
                    ...n,
                    // Ensure backward compatibility if AI puts data in different fields
                    sceneDescriptionEN: baseVisual, 
                    imagePrompt: fullImagePrompt
                } as StoryNode;
            });
        }

        // Validation: Ensure start node exists
        if (!nodeMap['start']) {
             const firstKey = Object.keys(nodeMap)[0];
             if(firstKey) {
                 const node = nodeMap[firstKey];
                 delete nodeMap[firstKey];
                 node.id = 'start';
                 nodeMap['start'] = node;
             } else {
                 throw new Error("Story generation failed: Empty story");
             }
        }

        return {
            id: `story_${Date.now()}`,
            title: rawJson.title || "无题故事",
            topic: rawJson.topic || prompt,
            cover: "https://picsum.photos/seed/cover/800/600", // Will be replaced by generated image
            goal: "fun",
            voice: finalVoice,
            style: style,
            styleInstructions: rawJson.styleInstructions,
            ttsModel: ttsModel,
            date: new Date().toISOString().split('T')[0],
            status: 'draft',
            nodes: nodeMap,
            tags: [style]
        };
    } catch (e: any) {
        console.error("Story Generation Failed:", e);
        if (e.message && e.message.includes("500")) {
             throw new Error("服务器繁忙 (500)。请尝试缩短提示词或稍后再试。");
        }
        if (e.message.includes("JSON")) {
            throw new Error("故事结构生成失败。请尝试更简单的提示词。");
        }
        throw e;
    }
};

export const generateSceneImage = async (prompt: string, cacheKey: string): Promise<string | null> => {
    const cached = await storageService.getImage(cacheKey);
    if (cached) return cached;

    const ai = await getAI();
    try {
        let finalPrompt = prompt;
        // Reinforce the vertical aspect ratio just in case the generated prompt missed it
        if (!finalPrompt.toLowerCase().includes("9:16") && !finalPrompt.toLowerCase().includes("vertical")) {
            finalPrompt += ", vertical 9:16 aspect ratio";
        }

        const response = await withRetry(ai => ai.models.generateContent({
            model: 'gemini-2.5-flash-image', 
            contents: { parts: [{ text: finalPrompt }] },
        })) as GenerateContentResponse;

        let base64Img = '';
        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.mimeType.startsWith('image')) {
                    base64Img = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    break;
                }
            }
        }

        if (base64Img) {
            await storageService.saveImage(cacheKey, base64Img);
            return base64Img;
        }
    } catch (e) {
        console.error("Image gen failed", e);
    }
    return null;
};

// --- Analysis Logic ---

export const matchIntentLocally = (transcript: string, options: any[]): number | null => {
    for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (transcript.includes(opt.label)) return i;
    }
    return null;
};

export const analyzeChildInput = async (context: string, options: any[], transcript: string) => {
    const ai = await getAI();
    
    const schema: Schema = {
        type: Type.OBJECT,
        properties: {
            action: { type: Type.STRING, enum: ['SELECT_OPTION', 'ASK_CLARIFICATION'] },
            selectedOptionIndex: { type: Type.INTEGER },
            replyText: { type: Type.STRING, description: "A gentle response acknowledging what the child said." }
        }
    };

    const prompt = `
    Context: ${context}
    Options: ${JSON.stringify(options.map((o, i) => ({ index: i, text: o.label })))}
    Child said: "${transcript}"
    
    Task: Identify the child's intent. Even if they don't say the exact option words, interpret their meaning.
    If they are engaging with the story creatively but not answering the choice, acknowledge that too before guiding them.
    `;

    const response = await withRetry(ai => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: schema
        }
    })) as GenerateContentResponse;

    return JSON.parse(response.text || '{}');
};

export const cacheStoryAssets = async (story: Story, onProgress?: (current: number, total: number) => void): Promise<Story> => {
    const nodes = Object.values(story.nodes);
    const total = nodes.length * 2; 
    let current = 0;

    const updateProgress = () => {
        current++;
        if (onProgress) onProgress(current, total);
    };

    const promises = [];
    const model = sanitizeModel(story.ttsModel);

    for (const node of nodes) {
        const speech = constructNodeSpeech(node);
        promises.push(new Promise<void>(resolve => {
            prefetchAudio(speech, story.voice, model);
            setTimeout(() => { updateProgress(); resolve(); }, 500); 
        }));

        if (node.imagePrompt) {
            const imgKey = `${story.id}_${node.id}`;
            promises.push(generateSceneImage(node.imagePrompt, imgKey).then(() => {
                updateProgress();
            }));
        }
    }

    await Promise.allSettled(promises);
    
    // Attempt to update the story cover with the generated start image
    const startImgKey = `${story.id}_start`;
    const startImg = await storageService.getImage(startImgKey);
    
    return { 
        ...story, 
        isOfflineReady: true,
        cover: startImg || story.cover 
    };
};
