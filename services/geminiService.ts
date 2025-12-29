
import { GoogleGenAI, Modality, Type, Schema, GenerateContentResponse } from "@google/genai";
import { Story, StoryNode, UserChoice, ReportData } from "../types";
import { decode, decodeAudioData, blobToBase64 } from "./audioUtils";
import { storageService } from "./storageService";
import { errorBus } from "./errorBus"; // Import the bus

// Export available models for UI usage
export const AVAILABLE_TTS_MODELS = [
    { id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash TTS', desc: '云端·极速·低延迟 (推荐)' },
    { id: 'gemini-2.5-flash-native-audio-preview-09-2025', name: 'Gemini 2.5 Native Audio', desc: '云端·情感自然 (原生音频)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: '云端·通用多模态' },
    { id: 'browser-tts', name: '本地浏览器语音 (Local)', desc: '本地·零流量·零延迟 (无需联网)' },
];

// Export available voices (Cloud)
export const AVAILABLE_VOICES = [
    { id: 'Kore', name: 'Kore', label: '温柔姐姐 (Kore)', desc: '云端·治愈', type: 'cloud', gender: 'female' },
    { id: 'Puck', name: 'Puck', label: '淘气包 (Puck)', desc: '云端·冒险', type: 'cloud', gender: 'male' },
    { id: 'Charon', name: 'Charon', label: '老爷爷 (Charon)', desc: '云端·深沉', type: 'cloud', gender: 'male' },
    { id: 'Fenrir', name: 'Fenrir', label: '探险家 (Fenrir)', desc: '云端·悬疑', type: 'cloud', gender: 'male' },
    { id: 'Zephyr', name: 'Zephyr', label: '小精灵 (Zephyr)', desc: '云端·童话', type: 'cloud', gender: 'female' },
    { id: 'Aoede', name: 'Aoede', label: '百灵鸟 (Aoede)', desc: '云端·科普', type: 'cloud', gender: 'female' },
];

// Helper to get system voices (Local)
export const getSystemVoices = (): Promise<{ id: string; name: string; label: string; desc: string; type: 'local' }[]> => {
    return new Promise((resolve) => {
        const fetchVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
                // Filter for Chinese and English voices mostly, or all if preferred
                const relevantVoices = voices
                    .filter(v => v.lang.includes('zh') || v.lang.includes('en'))
                    .map(v => ({
                        id: v.name, // Use name as ID for local voices
                        name: v.name,
                        label: `${v.name.replace(/Microsoft |Google |Desktop /g, '')}`,
                        desc: `本地·${v.lang}`,
                        type: 'local' as const
                    }));
                resolve(relevantVoices);
                return true;
            }
            return false;
        };

        if (!fetchVoices()) {
            window.speechSynthesis.onvoiceschanged = fetchVoices;
            // Fallback if event never fires (some browsers)
            setTimeout(fetchVoices, 1000);
        }
    });
};

// Helper for dynamic client creation to support API key switching at runtime
const getAI = () => {
    const key = process.env.API_KEY;
    if (!key) throw new Error("API Key is missing. Please set it in the environment or via the settings.");
    return new GoogleGenAI({ apiKey: key });
};

// Global Circuit Breaker for Quota Limits
export class QuotaExhaustedError extends Error {
    constructor() {
        super("API_QUOTA_EXHAUSTED");
        this.name = "QuotaExhaustedError";
    }
}

// Retry wrapper for 429 Rate Limit / Quota Exceeded errors
async function withRetry<T>(operation: (ai: GoogleGenAI) => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> {
    try {
        const ai = getAI();
        return await operation(ai);
    } catch (error: any) {
        // Check for 429 in various formats
        const isQuotaError = error.status === 429 || error.code === 429 || (error.message && error.message.includes('429'));
        // Check for hard limit 0 or exhausted
        const isLimitZero = error.message && (
            error.message.includes('limit: 0') || 
            error.message.includes('Quota exceeded')
        );

        if (isLimitZero) {
            errorBus.emit({
                level: 'error', // Downgraded from 'fatal'
                title: '配额耗尽',
                message: 'API 调用次数已达今日上限。',
                details: error
            });
            throw new QuotaExhaustedError();
        }
        
        if (isQuotaError && retries > 0) {
            // Emit a warning toast on first retry
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

// --- Rate Limiter for Background Tasks (Prefetching) ---
class RateLimiter {
    private queue: (() => Promise<void>)[] = [];
    private processing = false;
    private gap = 1500; // Reduced gap slightly for faster background prefetching

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
                    // Suppress background errors
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
    let textToRead = node.audioText || node.text || "";
    
    // Helper to ensure sentence ends with punctuation for natural pause
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
        // 1. Append Question if missing
        if (node.question && !textToRead.includes(node.question)) {
            textToRead += ` ${node.question}`;
        }
        
        // Ensure the text so far ends with punctuation (likely a question mark if we just added a question)
        textToRead = ensurePunctuation(textToRead, "？");

        // 2. Append Options for Voice Interaction
        // Use a child-friendly prompt format: "You can say: [A], or [B]."
        if (node.options && node.options.length > 0) {
            const labels = node.options.map(opt => opt.label);
            // Join with "or" and ensure pauses with commas
            const optionsText = labels.join('，或者 ');
            textToRead += ` 你可以说：${optionsText}。`;
        }
    }
    return textToRead.trim();
};

// --- Audio / TTS System ---

let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let activeRequestId = 0; // Use to track and cancel pending requests

export const initializeAudio = async () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    // Play a silent buffer to "warm up" the context
    const buffer = audioContext.createBuffer(1, 1, 22050);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
};

export const stopAudio = () => {
    activeRequestId++;
    if (currentSource) {
        try {
            currentSource.stop();
            // Disconnecting source from the graph stops sound
            currentSource.disconnect();
        } catch (e) {
            // ignore
        }
        currentSource = null;
    }
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
};

const getAudioContext = async () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
    return audioContext;
};

// --- Audio Cache System (Memory + DB) ---
const memoryCache = new Map<string, Promise<AudioBuffer>>();

// Helper for consistent string hashing
const stringHash = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
};

// Include model in cache key so switching models refreshes audio
// REFACTORED: Use Hash of text instead of substring to prevent collisions and length limits
const getCacheKey = (text: string, voice: string, model: string = 'default') => 
    `${model}:${voice}:${stringHash(text)}`;

// Helper to sanitize model name to prevent 404s
const sanitizeModel = (model: string | undefined): string => {
    if (!model) return 'gemini-2.5-flash-preview-tts';
    const isValidModel = AVAILABLE_TTS_MODELS.some(m => m.id === model);
    if (isValidModel) return model;
    if (model.includes('latest') || model.includes('flash-lite')) {
        return 'gemini-2.5-flash-preview-tts';
    }
    return model;
};

// FIXED: Prefetch now proactively loads/decodes DB content into Memory Cache
export const prefetchAudio = (text: string, voice: string, rawModel: string = 'gemini-2.5-flash-preview-tts') => {
    // 1. Check if model is local browser tts
    if (rawModel === 'browser-tts') return;

    // 2. Check if voice is local (legacy check)
    const isLocalVoice = !AVAILABLE_VOICES.some(v => v.id === voice);
    if (isLocalVoice) return; 

    const model = sanitizeModel(rawModel);
    const key = getCacheKey(text, voice, model);
    
    // 3. Check Memory (Already requested)
    if (memoryCache.has(key)) return;

    // 4. Create a Promise that handles BOTH DB hit and API miss
    const promise = new Promise<AudioBuffer>(async (resolve, reject) => {
        try {
            // 4a. Check DB First
            const dbData = await storageService.getAudio(key);
            if (dbData) {
                // HIT! Decode immediately so it's ready in RAM
                const ctx = await getAudioContext();
                // Ensure dbData is viewed as Uint8Array
                const buffer = await decodeAudioData(new Uint8Array(dbData), ctx, 24000, 1);
                resolve(buffer);
                return;
            }

            // 4b. MISS! Queue API fetch in background
            backgroundQueue.add(async () => {
                try {
                    // Double check cache inside queue (in case another process filled it)
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
                    
                    // Save raw bytes to DB
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

    // Handle background errors gracefully
    promise.catch(() => {}); 
    memoryCache.set(key, promise);
};

// --- SILENT BACKGROUND CACHING FOR APP LOAD ---
export const backgroundCacheHighPriority = async (story: Story) => {
    if (story.isOfflineReady) return;
    
    const model = sanitizeModel(story.ttsModel);
    // Only prefetch if it's a Cloud Voice
    if (model === 'browser-tts' || !AVAILABLE_VOICES.some(v => v.id === story.voice)) {
        return;
    }

    console.log("Starting silent background cache for story:", story.title);

    // 1. Cache START Node Audio
    const startNode = story.nodes['start'];
    if (startNode) {
        const startText = constructNodeSpeech(startNode);
        prefetchAudio(startText, story.voice, model);

        // 1.1 Cache Start Image
        if (startNode.imagePrompt) {
            const imgKey = `${story.id}_start`;
            storageService.hasImage(imgKey).then(exists => {
                if (!exists) generateSceneImage(startNode.imagePrompt, imgKey).catch(()=>{});
            });
        }
    }

    // 2. Cache Depth 1 Audio (Next Options)
    // This allows the user to play the first scene and immediately have the next scene ready
    const queueNextNodes = (node: StoryNode) => {
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
    }

    if (startNode) {
        queueNextNodes(startNode);
    }
};

export const generateSceneImage = async (prompt: string, cacheKey: string): Promise<string | undefined> => {
    // Check DB
    const cached = await storageService.getImage(cacheKey);
    if (cached) return cached;

    try {
         // Using gemini-2.5-flash-image as per guidelines for general image generation
         const response = await withRetry(ai => ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ text: prompt }]
            },
        })) as GenerateContentResponse;

        let base64Img: string | undefined;

        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    base64Img = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    break;
                }
            }
        }
        
        if (base64Img) {
            await storageService.saveImage(cacheKey, base64Img);
            return base64Img;
        }
    } catch (e: any) {
        console.error("Image generation failed", e);
        // Only warn for image failures, don't crash story
        if (e instanceof QuotaExhaustedError || e.message?.includes('Quota')) {
             errorBus.emit({ level: 'warning', title: '图片加载失败', message: '图片生成配额已用完，将使用默认封面。' });
        }
    }
    return undefined;
};

// --- Batch Download for Offline Mode (Audio & Images) ---
// Now returns the updated story if cover image was generated
export const cacheStoryAssets = async (story: Story, onProgress: (current: number, total: number) => void): Promise<Story> => {
    const nodes = Object.values(story.nodes);
    // Double the total steps estimate: Audio + potential Image for each node
    const totalEstimate = nodes.length * 2; 
    let completedOps = 0;
    
    let model = sanitizeModel(story.ttsModel);

    // If model is set to 'browser-tts', we DO NOT need to cache audio
    const isCloudModel = model !== 'browser-tts';
    const isCloudVoice = AVAILABLE_VOICES.some(v => v.id === story.voice);
    
    // Track updates
    let updatedStory = { ...story };
    let hasUpdates = false;
    let failedCount = 0;

    for (const node of nodes) {
        // 1. Audio (Only fetch if it's a Cloud Model AND Cloud Voice)
        if (isCloudModel && isCloudVoice) {
            const text = constructNodeSpeech(node);
            const audioKey = getCacheKey(text, story.voice, model);
            const audioExists = await storageService.hasAudio(audioKey);
            
            if (!audioExists) {
                try {
                // INCREASED Throttling to prevent 429 during batch download
                await new Promise(r => setTimeout(r, 1000)); 
                const response = await withRetry(ai => ai.models.generateContent({
                        model: model,
                        contents: [{ parts: [{ text }] }],
                        config: {
                            responseModalities: [Modality.AUDIO],
                            speechConfig: {
                                voiceConfig: {
                                    prebuiltVoiceConfig: { voiceName: story.voice },
                                },
                            },
                        },
                    })) as GenerateContentResponse;

                    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                    if (base64Audio) {
                        const audioBytes = decode(base64Audio);
                        await storageService.saveAudio(audioKey, audioBytes.buffer);
                    } else {
                        throw new Error("Empty audio response");
                    }
                } catch(e) {
                    console.error("Audio cache failed for node:", node.id, e);
                    failedCount++;
                }
            }
        }
        completedOps++;
        onProgress(completedOps, totalEstimate);

        // 2. Image
        if (node.imagePrompt) {
            const imgKey = `${story.id}_start`;
            let base64Img: string | null | undefined = null;
            
            // Check cache
            const imgExists = await storageService.hasImage(imgKey);
            
            if (imgExists) {
                 base64Img = await storageService.getImage(imgKey);
            } else {
                 try {
                     await new Promise(r => setTimeout(r, 1000)); // Throttling for image gen
                     base64Img = await generateSceneImage(node.imagePrompt, imgKey);
                } catch(e) {
                    // Image failure is not critical for "Offline Ready" logic, but good to know
                }
            }
            
            if (node.id === 'start' && base64Img) {
                if (updatedStory.cover !== base64Img) {
                    updatedStory.cover = base64Img;
                    hasUpdates = true;
                }
            }
        }
        completedOps++;
        onProgress(completedOps, totalEstimate);
    }

    // Only mark as offline ready if NO audio files failed
    updatedStory.isOfflineReady = failedCount === 0;
    
    await storageService.saveStory(updatedStory);
    
    return updatedStory;
};

// --- Story Generation ---

// STRICT Schema mapping for psychological traits
const storySchema: Schema = {
    type: Type.OBJECT,
    properties: {
        title: { type: Type.STRING },
        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        nodes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    id: { type: Type.STRING },
                    text: { type: Type.STRING },
                    imagePrompt: { type: Type.STRING },
                    // Support linear, choice, and end
                    type: { type: Type.STRING, enum: ["choice", "linear", "end"] },
                    // Next property for linear nodes
                    next: { type: Type.STRING, nullable: true },
                    question: { type: Type.STRING, nullable: true },
                    options: {
                        type: Type.ARRAY,
                        nullable: true,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                label: { type: Type.STRING },
                                text: { type: Type.STRING },
                                keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                                next: { type: Type.STRING },
                                type: { 
                                    type: Type.STRING, 
                                    // UPDATED ENUMS: Parents care about these 6 dimensions
                                    enum: ["Confidence", "Social", "Logic", "Resilience", "Independence", "Creativity"] 
                                }
                            },
                            required: ["label", "text", "next", "type"]
                        }
                    }
                },
                required: ["id", "text", "imagePrompt", "type"]
            }
        }
    },
    required: ["title", "nodes", "tags"]
};

// Helper function to robustly extract JSON from AI response
const extractJSON = (text: string): any => {
    text = text.trim();
    const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = text.match(jsonBlockRegex);
    if (match) {
        text = match[1];
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
        text = text.substring(firstBrace, lastBrace + 1);
    }
    return JSON.parse(text);
};

export const generateStoryScript = async (
    customPrompt: string, 
    style: string, 
    voice: string,
    childName: string = "乐乐",
    // These params aren't used for generation but passed to the result object
    ttsModel: string = "gemini-2.5-flash-preview-tts"
): Promise<Story> => {
    
    const systemPrompt = `
# Role: Heart-Voice (Interactive Story Engine)
You are an expert interactive story generator for children.
Your goal is to create a branching narrative graph in JSON format based on the user's request.

# Story Request
- **Protagonist**: ${childName}
- **Premise**: ${customPrompt}
- **Style**: ${style}
- **Language**: Chinese (Spoken/Colloquial). Vivid and engaging.

# CRITICAL: GRAPH STRUCTURE REQUIREMENTS
You MUST generate a valid directed graph with the following structure:
1.  **Node Count**: Generate between 8 and 12 nodes.
2.  **Starting Point**: The ID of the first node MUST be "start".
3.  **Node Types**:
    - \`choice\`: A node where the story pauses for the child to make a decision. MUST have an \`options\` array with 2 distinct choices.
    - \`linear\`: A transition node that tells more story and automatically moves to the next node. MUST have a \`next\` field pointing to a valid ID.
    - \`end\`: A conclusion node. No \`next\` or \`options\`.
4.  **Branching Logic**:
    - The "start" node MUST be type \`choice\`.
    - Use "linear" nodes to expand the narrative between choices.
    - Ensure there are at least 2 distinct paths leading to different "end" nodes.
    - Do not create infinite loops.

# Psychological Dimensions (for 'options.type')
Each choice option must correspond to one of these 6 modern parenting dimensions:
- **Confidence** (自信): Speaking up, feeling secure, bravery.
- **Social** (社交情商): Empathy, collaboration, understanding others, kindness.
- **Logic** (逻辑思辨): Honesty, truth-seeking, analyzing problems, rationality.
- **Resilience** (抗挫逆商): Not giving up, handling failure, grit.
- **Independence** (独立自主): Doing things alone, making own decisions.
- **Creativity** (创造想象): Innovation, thinking outside the box, imagination.

# Voice Interaction Data
For each option, provide:
- \`label\`: Short action (e.g., "跳过去").
- \`text\`: What the child says (e.g., "我不怕，我要跳过去！").
- \`keywords\`: 3-5 synonyms for voice recognition (e.g., ["跳", "过河", "我敢"]).

# Output Format
Return ONLY a raw JSON object matching the schema.
    `;

    // Strategy: Try Pro model first for quality. If fails (quota/network), fallback to Flash for speed/reliability.
    const attemptGeneration = async (modelName: string, useThinking: boolean) => {
        return await withRetry(ai => ai.models.generateContent({
            model: modelName, 
            contents: systemPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: storySchema,
                maxOutputTokens: 8192, 
                thinkingConfig: useThinking ? { thinkingBudget: 2048 } : undefined
            }
        })) as GenerateContentResponse;
    };

    let text = "";
    try {
        console.log("Generating story with Gemini 3 Pro...");
        const response = await attemptGeneration("gemini-3-pro-preview", true);
        text = response.text || "";
    } catch (e: any) {
        console.warn("Pro model failed, falling back to Flash.", e);
        errorBus.emit({ level: 'info', message: '正在切换至极速模型继续创作...', title: 'Model Switch' });
        
        try {
            const response = await attemptGeneration("gemini-3-flash-preview", false);
            text = response.text || "";
        } catch (flashError) {
             console.error("Flash model also failed", flashError);
             throw flashError;
        }
    }

    if (!text) throw new Error("No response from AI");
    
    let data;
    try {
        data = extractJSON(text);
    } catch (e) {
        console.error("JSON Parse Failed.", text);
        throw new Error("故事生成过程中遇到了一点小麻烦，请尝试换个简单点的主题再试试。");
    }
    
    const nodesRecord: Record<string, StoryNode> = {};
    if (Array.isArray(data.nodes)) {
        data.nodes.forEach((node: any) => {
            nodesRecord[node.id] = node;
        });
    }

    if (!nodesRecord['start']) {
        const firstKey = Object.keys(nodesRecord)[0];
        if (firstKey) {
            nodesRecord['start'] = { ...nodesRecord[firstKey], id: 'start' };
        }
    }

    const newStory: Story = {
        id: `gen_${Date.now()}`,
        title: data.title || "AI Generated Story",
        topic: customPrompt.substring(0, 20) + "...", 
        goal: "custom",
        voice: voice,
        style: style,
        ttsModel: sanitizeModel(ttsModel), 
        date: new Date().toISOString().split('T')[0],
        status: 'draft',
        cover: `https://picsum.photos/seed/${Date.now()}/400/400`,
        tags: data.tags || ['AI'],
        nodes: nodesRecord,
        isOfflineReady: false
    };
    
    await storageService.saveStory(newStory);
    return newStory;
};

interface PlayAudioOptions {
    text: string;
    voiceName?: string;
    model?: string;
    onEnd?: () => void;
    onNearEnd?: () => void; 
    onError?: (error: any) => boolean; 
}

export const playTextToSpeech = async (
    { text, voiceName = 'Kore', model: rawModel = 'gemini-2.5-flash-preview-tts', onEnd, onNearEnd, onError }: PlayAudioOptions
): Promise<void> => {
    stopAudio();
    const requestId = ++activeRequestId;
    const model = sanitizeModel(rawModel);

    const playBrowserTTS = (specificVoiceName?: string) => {
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'zh-CN';
            utterance.rate = 1.0; 
            utterance.volume = 1.0; 
            
            if (specificVoiceName) {
                const voices = window.speechSynthesis.getVoices();
                let targetVoice = voices.find(v => v.name === specificVoiceName);
                
                // If Cloud voice name is passed (e.g. 'Puck') but not found locally, try to find a reasonable fallback
                if (!targetVoice && AVAILABLE_VOICES.some(v => v.id === specificVoiceName)) {
                     // Check gender of requested cloud voice
                     const cloudVoice = AVAILABLE_VOICES.find(v => v.id === specificVoiceName);
                     if (cloudVoice) {
                         // Try to find a local voice that might match (this is fuzzy and browser dependent)
                         // Prioritize Chinese voices
                         const zhVoices = voices.filter(v => v.lang.includes('zh'));
                         // If we want female/male, browsers don't expose gender reliably, so just pick first zh voice
                         if (zhVoices.length > 0) targetVoice = zhVoices[0];
                     }
                }

                if (targetVoice) utterance.voice = targetVoice;
            }

            utterance.onend = () => { 
                if (requestId === activeRequestId && onEnd) onEnd(); 
            };
            utterance.onerror = (e) => {
                 console.warn("Browser TTS Error", e);
                 if (requestId === activeRequestId && onEnd) onEnd(); 
            };
            window.speechSynthesis.speak(utterance);
        } else {
            if (onEnd) setTimeout(onEnd, 1000); 
        }
    };

    if (model === 'browser-tts') {
        playBrowserTTS(voiceName);
        return;
    }

    const isCloudVoice = AVAILABLE_VOICES.some(v => v.id === voiceName);

    if (!isCloudVoice) {
        playBrowserTTS(voiceName);
        return;
    }

    try {
        const ctx = await getAudioContext();
        if (requestId !== activeRequestId) return;

        const cacheKey = getCacheKey(text, voiceName, model);
        let audioBuffer: AudioBuffer | undefined;

        // FIXED: Only check Memory Cache first. DB Logic is moved to fallback block to force caching.
        // Actually, for performance, we check DB here too, BUT we ensure we cache the result to memory.
        
        if (memoryCache.has(cacheKey)) {
             try {
                console.log("TTS: Waiting for Prefetch (Memory)...");
                audioBuffer = await memoryCache.get(cacheKey)!;
             } catch(e) {
                 memoryCache.delete(cacheKey);
             }
        }
        
        if (!audioBuffer) {
             // Check DB directly
             const dbData = await storageService.getAudio(cacheKey);
             if (dbData) {
                 console.log("TTS: Playing from IndexedDB (Cold Start)");
                 // Decode
                 const bufferPromise = decodeAudioData(new Uint8Array(dbData), ctx, 24000, 1);
                 // Cache the decoding promise so next time it's instant
                 memoryCache.set(cacheKey, bufferPromise);
                 audioBuffer = await bufferPromise;
             }
        }
        
        if (!audioBuffer) {
            console.log(`TTS: Fetching Live (${model})...`);
            
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

            if (requestId !== activeRequestId) return;

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) throw new Error("No audio data returned");
            
            const rawBytes = decode(base64Audio);
            
            // Save RAW bytes
            storageService.saveAudio(cacheKey, rawBytes.buffer).catch(() => {});

            // Decode RAW bytes (which applies WAV header wrapper internally)
            const bufferPromise = decodeAudioData(rawBytes, ctx, 24000, 1);
            memoryCache.set(cacheKey, bufferPromise);
            audioBuffer = await bufferPromise;
        }

        if (!audioBuffer) throw new Error("Failed to create audio buffer");

        if (requestId !== activeRequestId) return;

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        
        // --- AUDIO GRAPH FOR VOLUME NORMALIZATION ---
        // Native PCM is usually quieter and more dynamic than system audio.
        // We use a Compressor to even out dynamics and a Gain to boost level.
        
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -20; // Start compressing earlier
        compressor.knee.value = 30;
        compressor.ratio.value = 4; // 4:1 compression
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;

        const gainNode = ctx.createGain();
        gainNode.gain.value = 2.0; // Boost makeup gain to 200%

        source.connect(compressor);
        compressor.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        source.start();
        currentSource = source;
        
        if (onNearEnd) {
             const duration = audioBuffer.duration;
             const earlyTriggerTime = Math.max(0, (duration - 1.5) * 1000);
             setTimeout(() => {
                 if (requestId === activeRequestId) {
                     onNearEnd();
                 }
             }, earlyTriggerTime);
        }

        source.onended = () => {
            if (requestId === activeRequestId) {
                currentSource = null;
                if (onEnd) onEnd();
            }
        };

    } catch (error: any) {
        if (requestId !== activeRequestId) return;
        
        if (onError && onError(error)) {
            return;
        }

        if (error instanceof QuotaExhaustedError || error.message === 'API_QUOTA_EXHAUSTED' || error.message?.includes('429')) {
             console.warn("TTS API unavailable (Quota). Falling back to Browser TTS.");
             errorBus.emit({ level: 'warning', message: 'AI 配额不足，已切换至本地语音。', title: 'TTS Fallback' });
        } else {
             console.error("TTS Error", error);
             errorBus.emit({ level: 'warning', message: '语音加载失败，尝试使用本地语音。', title: 'TTS Error' });
        }
        
        // Fix: Pass voiceName to fallback so it can attempt to match or use default consistently
        playBrowserTTS(voiceName);
    }
};

export const matchIntentLocally = (transcript: string, options: any[]): number | null => {
    if (!options) return null;
    const lowerTranscript = transcript.toLowerCase();
    
    for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (lowerTranscript.includes(opt.label.toLowerCase())) return i;
        if (opt.keywords && Array.isArray(opt.keywords)) {
            for (const kw of opt.keywords) {
                 if (lowerTranscript.includes(kw.toLowerCase())) return i;
            }
        }
    }
    return null;
};

export const analyzeChildInput = async (context: string, options: any[], childInput: string): Promise<{
    action: 'SELECT_OPTION' | 'ASK_CLARIFICATION' | 'UNKNOWN';
    selectedOptionIndex?: number;
    replyText?: string;
}> => {
     
     const prompt = `
     Context: ${context}
     Options: ${JSON.stringify(options.map((o, i) => ({ index: i, label: o.label, text: o.text })))}
     Child said: "${childInput}"
     
     Determine which option the child wants.
     `;

    try {
        const response = await withRetry(ai => ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        action: { type: Type.STRING, enum: ["SELECT_OPTION", "ASK_CLARIFICATION"] },
                        selectedOptionIndex: { type: Type.INTEGER },
                        replyText: { type: Type.STRING }
                    }
                }
            }
        })) as GenerateContentResponse;

        if (response.text) {
             return extractJSON(response.text);
        }
    } catch (e: any) {
        console.error("Input Analysis Failed", e);
        if (e instanceof QuotaExhaustedError) {
             errorBus.emit({ level: 'error', message: '无法识别语音（配额不足），请点击屏幕选项。', title: 'Input Error' });
        } else {
             errorBus.emit({ level: 'warning', message: '网络开小差了，请再说一次。', title: 'Network' });
        }
    }
    return { action: 'UNKNOWN' };
};

export const generateParentingReport = async (storyTitle: string, choices: UserChoice[]): Promise<ReportData> => {
     
     const prompt = `
     Analyze choices AND SPOKEN TRANSCRIPTS for story "${storyTitle}".
     
     Choices Data: ${JSON.stringify(choices)}
     
     Task:
     1. Analyze the child's psychological traits based on their decisions.
     2. **CRITICAL**: Analyze the 'transcript' (what they actually said) and 'speechHistory' (what they said before picking) to find specific psychological evidence.
        - If they said "I'm scared but I'll do it", map this quote to "Confidence".
        - If they said "He looks sad, let's help", map this quote to "Social".
     3. Generate a report with a mapping of these specific quotes to traits.
     
     **LANGUAGE REQUIREMENT**:
     - The output content (summary, analysis, suggestions, reasons) MUST BE in **Simplified Chinese (简体中文)**.
     - The dimension keys (Confidence, Social, etc.) must remain in English as per the schema.

     Dimensions MUST use these EXACT keys (The 6 modern parenting pillars):
     - Confidence (replacing Security)
     - Social (replacing Empathy)
     - Logic (replacing Honesty)
     - Resilience
     - Independence
     - Creativity (replacing Imagination)
     
     **Growth Scoring**:
     - Assign a 'score' (0-100) for current performance.
     - Assign a 'delta' (integer 2-10) representing the growth points gained in this session. 
     - IMPORTANT: 'delta' MUST be an integer between 2 and 10 to be noticeable in the UI. Do not return 0 or 1 unless there is absolutely no growth.
     `;
     
     try {
         const response = await withRetry(ai => ai.models.generateContent({
             model: "gemini-3-pro-preview",
             contents: prompt,
             config: {
                 responseMimeType: "application/json",
                 responseSchema: {
                     type: Type.OBJECT,
                     properties: {
                         summary: { type: Type.STRING },
                         traitAnalysis: { type: Type.STRING },
                         suggestion: { type: Type.STRING },
                         dimensions: {
                             type: Type.ARRAY,
                             items: {
                                 type: Type.OBJECT,
                                 properties: {
                                     subject: { type: Type.STRING, enum: ["Confidence", "Social", "Logic", "Resilience", "Independence", "Creativity"] },
                                     score: { type: Type.NUMBER },
                                     delta: { type: Type.INTEGER, description: "Growth points (2-10) for visual impact" },
                                     reason: { type: Type.STRING }
                                 }
                             }
                         },
                         highlightQuote: { type: Type.STRING },
                         highlightAnalysis: { type: Type.STRING },
                         keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                         evidencePoints: {
                             type: Type.ARRAY,
                             items: {
                                 type: Type.OBJECT,
                                 properties: {
                                     trait: { type: Type.STRING },
                                     quote: { type: Type.STRING },
                                     context: { type: Type.STRING },
                                     analysis: { type: Type.STRING },
                                     timestamp: { type: Type.INTEGER }
                                 }
                             }
                         }
                     }
                 }
             }
         })) as GenerateContentResponse;
         
         if (response.text) return extractJSON(response.text);
         
     } catch (e: any) {
         console.error(e);
         if (e instanceof QuotaExhaustedError) {
             errorBus.emit({ level: 'error', message: '报告生成失败（配额不足）。', title: 'Report Error' });
         } else {
             errorBus.emit({ level: 'error', message: '报告生成失败，请稍后重试。', title: 'Report Error' });
         }
     }
     
     return {
         summary: "无法生成报告",
         traitAnalysis: "API Error",
         suggestion: "",
         dimensions: [],
         keywords: []
     };
};
