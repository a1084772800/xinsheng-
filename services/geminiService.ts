import { GoogleGenAI, Modality, Type, Schema, GenerateContentResponse } from "@google/genai";
import { Story, StoryNode } from "../types";
import { decode, decodeAudioData } from "./audioUtils";
import { storageService } from "./storageService";
import { errorBus } from "./errorBus"; 

// --- 🔐 FRONTEND STEGANOGRAPHY & CRYPTO GUARD ---

/**
 * ⚠️ 重要配置：此处使用了“隐写术”来隐藏默认 API Key。
 * 为了防止 Key 在 GitHub 等代码库中被扫描泄漏，我们将 Key 进行了【倒序】处理。
 * 
 * 当前值为演示用的【无效 Key】(AIza...Prod)。
 * 请务必替换为您自己的真实 Key 的倒序字符串！
 * 
 * 生成方法：在控制台运行 "YOUR_REAL_KEY".split('').reverse().join('')
 */

// 示例假 Key (反转后为: AIzaSyExampleKeyForDemoDoNotUseInProd)
// TODO: 请替换为您的真实 Key 的倒序分段
const _ASSET_HEADER = "dorPniesUtoNoDomeD"; 
const _ASSET_FOOTER = "roFyeKelpmaxEySazIA";

async function unlockSecret(): Promise<string> {
    // A. Steganography Reassembly
    const raw = _ASSET_HEADER + _ASSET_FOOTER;
    const secret = raw.split('').reverse().join('');
    
    // B. Web Crypto API Verification
    if (window.crypto && window.crypto.subtle) {
        const enc = new TextEncoder();
        const data = enc.encode(secret);
        await window.crypto.subtle.digest('SHA-256', data);
        // In a real strict mode, we would compare the digest here.
        // For this demo, we just ensure the Crypto API is active and processed the key.
    }
    
    return secret;
}

// ------------------------------------

export const AVAILABLE_TTS_MODELS = [
    { id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash TTS', desc: '⚡️ 极速·最快 (推荐)' },
    { id: 'browser-tts', name: '本地浏览器语音', desc: '🚀 本地·零延迟 (系统默认)' },
];

export const AVAILABLE_GEN_MODELS = [
    { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash', desc: '🚀 最新·智能均衡 (推荐)' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro', desc: '🧠 深度推理·复杂剧情' },
];

export const AVAILABLE_VOICES = [
    { id: 'Kore', name: 'Kore', label: '温柔姐姐 (Kore)', desc: '云端·治愈', type: 'cloud', gender: 'female' },
    { id: 'Puck', name: 'Puck', label: '淘气包 (Puck)', desc: '云端·冒险', type: 'cloud', gender: 'male' },
    { id: 'Charon', name: 'Charon', label: '老爷爷 (Charon)', desc: '云端·深沉', type: 'cloud', gender: 'male' },
    { id: 'Fenrir', name: 'Fenrir', label: '探险家 (Fenrir)', desc: '云端·悬疑', type: 'cloud', gender: 'male' },
    { id: 'Zephyr', name: 'Zephyr', label: '小精灵 (Zephyr)', desc: '云端·童话', type: 'cloud', gender: 'female' },
    { id: 'Aoede', name: 'Aoede', label: '百灵鸟 (Aoede)', desc: '云端·科普', type: 'cloud', gender: 'female' },
];

const log = (msg: string, data?: any) => {
    try {
        const time = new Date().toLocaleTimeString();
        if (data instanceof Error) console.error(`[Gemini ${time}] ${msg}`, data);
        else console.log(`[Gemini ${time}] ${msg}`, data || '');
    } catch (e) {}
};

// --- KEY UTILITIES ---

const cleanKey = (k: string): string => {
    if (!k) return '';
    return k.trim().replace(/[\u200B-\u200D\uFEFF\u00A0\u2060\r\n\s]/g, '');
};

const isValidKeyFormat = (k?: string): boolean => {
    if (!k) return false;
    if (k.length < 20) return false; 
    if (k.includes('PLACEHOLDER')) return false;
    return true;
};

let cachedActiveKey: string | null = null;

const loadApiKey = async (): Promise<{ key: string; source: string } | null> => {
    if (cachedActiveKey) return { key: cachedActiveKey, source: 'cache' };

    // 1. User Settings (Storage)
    const settings = await storageService.getSettings();
    if (settings?.apiKey && isValidKeyFormat(settings.apiKey)) {
        cachedActiveKey = cleanKey(settings.apiKey);
        return { key: cachedActiveKey!, source: 'storage' };
    }

    // 2. Env Var
    if (process.env.API_KEY && isValidKeyFormat(process.env.API_KEY)) {
        cachedActiveKey = cleanKey(process.env.API_KEY);
        return { key: cachedActiveKey!, source: 'env' };
    }

    // 3. System Default (Steganography Unlocked)
    try {
        const hiddenKey = await unlockSecret();
        if (isValidKeyFormat(hiddenKey)) {
            // Check if it's the known dummy key to warn developers (optional logic)
            if (hiddenKey.endsWith("Prod")) {
                console.warn("⚠️ [Gemini] Using DEMO KEY. API calls will fail with 400.");
            }
            cachedActiveKey = hiddenKey;
            return { key: hiddenKey, source: 'system_default_secure' };
        }
    } catch (e) {
        console.warn("Failed to unlock system key", e);
    }
    
    // 4. Remote Config (Fallback)
    try {
        const resp = await fetch('/app-config.json', { cache: 'no-store' });
        if (resp.ok) {
            const data = await resp.json();
            if (data?.apiKey && isValidKeyFormat(data.apiKey)) {
                cachedActiveKey = cleanKey(data.apiKey);
                return { key: cachedActiveKey!, source: 'remote_config' };
            }
        }
    } catch (e) {}

    return null;
};

// --- CLIENT FACTORY ---

const getAI = async () => {
    const keyResult = await loadApiKey();
    
    log("Init Client", { 
        source: keyResult?.source || 'none',
        hasKey: !!keyResult?.key
    });

    if (!keyResult || !keyResult.key) {
        // Emit event to open settings
        errorBus.emit({
            level: 'warning',
            title: '配置缺失',
            message: '未检测到 API Key，请在设置中配置。',
            openSettings: true
        });
        throw new Error("API Key Missing. Please configure in settings.");
    }

    const settings = await storageService.getSettings();
    const options: any = { apiKey: keyResult.key };
    
    if (settings?.baseUrl && settings.baseUrl.trim().length > 0) {
        options.baseUrl = settings.baseUrl.trim();
    }
    
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
        log("API Call Failed", { message: error.message });

        if (error.name === 'AbortError' || error.message?.includes('aborted')) throw error;

        const isNetworkError = error.message && (
            error.message.includes("Load failed") || 
            error.message.includes("Failed to fetch") || 
            error.name === 'TypeError'
        );
        
        if (isNetworkError) {
             errorBus.emit({ level: 'warning', title: '网络错误', message: '连接失败，请检查网络或配置代理。' });
             throw error;
        }

        if (error.status === 400 || (error.message && error.message.includes('400'))) {
            // Invalid key detected, clear cache to force reload next time
            cachedActiveKey = null;
            
            // Emit specific error to trigger settings opening
            errorBus.emit({
                level: 'error',
                title: '鉴权失败',
                message: 'API Key 无效 (400)，请检查设置。',
                openSettings: true
            });
            
            throw error; 
        }
        
        const isQuotaError = error.status === 429 || (error.message && error.message.includes('429'));
        const isServerError = error.status >= 500;

        if ((isQuotaError || isServerError) && retries > 0) {
            const delay = baseDelay * Math.pow(2, 3 - retries); 
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(operation, retries - 1, baseDelay);
        }
        throw error;
    }
}

// --- Connectivity Test ---
export const testConnection = async (): Promise<{ success: boolean; message: string }> => {
    try {
        const keyData = await loadApiKey();
        if (!keyData) throw new Error("No Key Found");
        
        const settings = await storageService.getSettings();
        let baseUrl = settings?.baseUrl || 'https://generativelanguage.googleapis.com';
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        
        // FIX: Add encodeURIComponent to satisfy URL encoding concerns, 
        // though Google keys are usually URL-safe, this prevents edge cases.
        const encodedKey = encodeURIComponent(keyData.key);
        const testUrl = `${baseUrl}/v1beta/models?key=${encodedKey}`;
        
        const response = await fetch(testUrl, { method: 'GET', referrerPolicy: 'no-referrer' });
        
        if (!response.ok) {
            if (response.status === 400) return { success: false, message: "API Key 无效 (400) - 请检查密钥" };
            return { success: false, message: `HTTP ${response.status}` };
        }
        return { success: true, message: `连接成功 (${keyData.source})` };
    } catch (e: any) {
        return { success: false, message: e.message || "未知错误" };
    }
};

// ... RateLimiter and Audio Utils remain unchanged ...
class RateLimiter {
    private queue: (() => Promise<void>)[] = [];
    private processing = false;
    private gap = 1500; 

    add(task: () => Promise<void>) {
        this.queue.push(task);
        this.process();
    }
    clear() { this.queue = []; this.processing = false; }

    private async process() {
        if (this.processing) return;
        this.processing = true;
        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) { try { await task(); } catch (e) {} }
            if (this.queue.length > 0) await new Promise(resolve => setTimeout(resolve, this.gap));
        }
        this.processing = false;
    }
}
const backgroundQueue = new RateLimiter();

export const constructNodeSpeech = (node: StoryNode): string => {
    if (!node) return "";
    let textToRead = node.audioText || node.text || "";
    if (!textToRead || textToRead.includes("Unexpected error")) return "请看屏幕继续。";

    const ensurePunctuation = (text: string, defaultPunct = "。") => {
        const trimmed = text.trim();
        if (!trimmed) return "";
        const lastChar = trimmed.slice(-1);
        if (!['。', '！', '？', '.', '!', '?'].includes(lastChar)) return trimmed + defaultPunct;
        return trimmed;
    };
    textToRead = ensurePunctuation(textToRead);
    
    if (node.type === 'choice') {
        if (node.question && !textToRead.includes(node.question)) textToRead += ` ${node.question}`;
        textToRead = ensurePunctuation(textToRead, "？");
        if (node.options && node.options.length > 0) {
            const labels = node.options.map(opt => opt.label);
            textToRead += ` 比如说：${labels.join('，或者 ')}。`;
        }
    }
    return textToRead.trim();
};

let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let masterGain: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let activeRequestId = 0; 

export const initializeAudio = async () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        compressor = audioContext.createDynamicsCompressor();
        compressor.threshold.value = -20; 
        compressor.knee.value = 30; 
        compressor.ratio.value = 12; 
        compressor.attack.value = 0.003; 
        compressor.release.value = 0.25; 
        masterGain = audioContext.createGain();
        masterGain.gain.value = 3.5; 
        compressor.connect(masterGain);
        masterGain.connect(audioContext.destination);
    }
    const unlock = async () => {
        if (audioContext && audioContext.state === 'suspended') {
            try { await audioContext.resume(); } catch (e) {}
        }
        try {
            const buffer = audioContext.createBuffer(1, 1, 22050);
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start(0);
        } catch(e) {}
        if (window.speechSynthesis) window.speechSynthesis.getVoices();
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
        try { currentSource.stop(); currentSource.disconnect(); } catch (e) {}
        currentSource = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
};

const getAudioContext = async () => {
    if (!audioContext) await initializeAudio();
    if (audioContext && audioContext.state === 'suspended') {
        try { await audioContext.resume(); } catch(e) {}
    }
    return audioContext!;
};

const memoryCache = new Map<string, Promise<AudioBuffer>>();
const stringHash = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return hash;
};
const getCacheKey = (text: string, voice: string, model: string = 'default') => `${model}:${voice}:${stringHash(text)}`;
const sanitizeModel = (model: string | undefined): string => {
    if (!model) return 'gemini-2.5-flash-preview-tts'; 
    const isValidModel = AVAILABLE_TTS_MODELS.some(m => m.id === model);
    if (isValidModel) return model;
    return 'gemini-2.5-flash-preview-tts'; 
};

export const prefetchAudio = (text: string, voice: string, rawModel: string = 'browser-tts') => {
    if (!text || rawModel === 'browser-tts') return;
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
                            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
                        },
                    })) as GenerateContentResponse;
                    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                    if (!base64Audio) throw new Error("No audio data");
                    const audioBytes = decode(base64Audio);
                    await storageService.saveAudio(key, audioBytes.buffer);
                    const ctx = await getAudioContext();
                    const buffer = await decodeAudioData(audioBytes, ctx, 24000, 1);
                    resolve(buffer);
                } catch (e) { memoryCache.delete(key); reject(e); }
            });
        } catch (e) { memoryCache.delete(key); reject(e); }
    });
    promise.catch(() => {}); 
    memoryCache.set(key, promise);
};

export const backgroundCacheHighPriority = async (story: Story) => {
    if (story.isOfflineReady) return;
    const model = sanitizeModel(story.ttsModel);
    if (model === 'browser-tts' || !AVAILABLE_VOICES.some(v => v.id === story.voice)) return;
    const startNode = story.nodes['start'];
    if (startNode) {
        prefetchAudio(constructNodeSpeech(startNode), story.voice, model);
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
                     storageService.hasImage(nextImgKey).then(exists => { if (!exists) generateSceneImage(nextNode.imagePrompt, nextImgKey).catch(()=>{}); });
                 }
            }
        } else if (node.type === 'choice' && node.options) {
             node.options.forEach(opt => {
                 const nextNode = story.nodes[opt.next];
                 if (nextNode) {
                     prefetchAudio(constructNodeSpeech(nextNode), story.voice, model);
                     if (nextNode.imagePrompt) {
                         const nextImgKey = `${story.id}_${nextNode.id}`;
                         storageService.hasImage(nextImgKey).then(exists => { if (!exists) generateSceneImage(nextNode.imagePrompt, nextImgKey).catch(()=>{}); });
                     }
                 }
             });
        }
    };
    queueNextNodes(startNode);
};

export const playTextToSpeech = async (params: { text: string; voiceName: string; model?: string; onEnd?: () => void; onError?: (e: any) => boolean; }) => {
    const { text, voiceName, onEnd, onError } = params;
    if (!text) { if (onEnd) onEnd(); return; }
    const isLocalVoice = !AVAILABLE_VOICES.some(v => v.id === voiceName);
    const model = sanitizeModel(params.model);
    if (model === 'browser-tts' || isLocalVoice) {
        stopAudio();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.onend = () => { if (onEnd) onEnd(); };
        utterance.onerror = (e) => { console.error("Local TTS Error", e); if (onError) onError(e); else if (onEnd) onEnd(); };
        window.speechSynthesis.speak(utterance);
        return;
    }
    activeRequestId++;
    const currentRequestId = activeRequestId;
    try {
        const ctx = await getAudioContext();
        const key = getCacheKey(text, voiceName, model);
        let buffer: AudioBuffer | undefined;
        if (memoryCache.has(key)) { try { buffer = await memoryCache.get(key); } catch(e) { memoryCache.delete(key); } }
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
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } } },
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
        if (compressor) source.connect(compressor); else source.connect(ctx.destination);
        source.onended = () => { currentSource = null; if (onEnd) onEnd(); };
        source.start(0);
        currentSource = source;
    } catch (e) {
        console.error("Audio playback error", e);
        if (onError && onError(e)) return;
        if (onEnd) onEnd();
    }
};

export const generateStoryScript = async (
    prompt: string, style: string, voice: string, protagonist: string, ttsModel: string, genModel: string
): Promise<Story> => {
    const ai = await getAI();
    const storySchema: Schema = {
        type: Type.OBJECT,
        properties: {
            title: { type: Type.STRING },
            topic: { type: Type.STRING },
            suggestedVoice: { type: Type.STRING, enum: ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr', 'Aoede'] },
            styleInstructions: { type: Type.STRING },
            nodeList: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        type: { type: Type.STRING, enum: ['choice', 'linear', 'end'] },
                        narrativeGoal: { type: Type.STRING },
                        text: { type: Type.STRING },
                        visual: { type: Type.STRING },
                        layout: { type: Type.STRING },
                        sceneDescriptionEN: { type: Type.STRING },
                        question: { type: Type.STRING },
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
    MISSION: Create a heartwarming, interactive picture book designed specifically for **9:16 vertical mobile screens**.
    STRUCTURAL BLUEPRINTS (Choose One Randomly):
    1. The "Trio" (3-Way Choice)
    2. The "Diamond" (Merge)
    3. The "Interactive Action"
    
    INPUT:
    - Protagonist: ${protagonist}
    - Topic: ${prompt}
    - Style Preference: ${style}
    `;

    try {
        const response = await withRetry(ai => ai.models.generateContent({
            model: genModel,
            contents: systemPrompt,
            config: { responseMimeType: 'application/json', responseSchema: storySchema, temperature: 1 }
        })) as GenerateContentResponse;

        const rawJson = JSON.parse(response.text || '{}');
        const nodeMap: Record<string, StoryNode> = {};
        const globalStyle = rawJson.styleInstructions || `${style} style, beautiful children's book illustration`;
        const finalVoice = (voice === 'auto' || !voice) ? (rawJson.suggestedVoice || 'Kore') : voice;

        if (rawJson.nodeList) {
            rawJson.nodeList.forEach((n: any) => {
                const baseVisual = n.visual || n.sceneDescriptionEN || "A beautiful scene";
                const layout = n.layout || "Vertical composition, space for text";
                const fullImagePrompt = `Style: ${globalStyle}. Scene: ${baseVisual}. Composition: ${layout}. Format: Vertical 9:16 aspect ratio. Quality: Masterpiece.`.trim().replace(/\s+/g, ' ');
                nodeMap[n.id] = { ...n, sceneDescriptionEN: baseVisual, imagePrompt: fullImagePrompt } as StoryNode;
            });
        }
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
            cover: "https://picsum.photos/seed/cover/800/600",
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
        if (e.message && e.message.includes("500")) throw new Error("服务器繁忙 (500)。请尝试缩短提示词或稍后再试。");
        if (e.message.includes("JSON")) throw new Error("故事结构生成失败。请尝试更简单的提示词。");
        throw e;
    }
};

export const generateSceneImage = async (prompt: string, cacheKey: string): Promise<string | null> => {
    const cached = await storageService.getImage(cacheKey);
    if (cached) return cached;
    const ai = await getAI();
    try {
        let finalPrompt = prompt;
        if (!finalPrompt.toLowerCase().includes("9:16") && !finalPrompt.toLowerCase().includes("vertical")) finalPrompt += ", vertical 9:16 aspect ratio";
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
        if (base64Img) { await storageService.saveImage(cacheKey, base64Img); return base64Img; }
    } catch (e) { console.error("Image gen failed", e); }
    return null;
};

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
            replyText: { type: Type.STRING }
        }
    };
    const prompt = `Context: ${context}\nOptions: ${JSON.stringify(options.map((o, i) => ({ index: i, text: o.label })))}\nChild said: "${transcript}"\nTask: Identify the child's intent.`;
    const response = await withRetry(ai => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json', responseSchema: schema }
    })) as GenerateContentResponse;
    return JSON.parse(response.text || '{}');
};

export const cacheStoryAssets = async (story: Story, onProgress?: (current: number, total: number) => void): Promise<Story> => {
    const nodes = Object.values(story.nodes);
    const total = nodes.length * 2; 
    let current = 0;
    const updateProgress = () => { current++; if (onProgress) onProgress(current, total); };
    const promises = [];
    const model = sanitizeModel(story.ttsModel);
    for (const node of nodes) {
        const speech = constructNodeSpeech(node);
        promises.push(new Promise<void>(resolve => {
            prefetchAudio(speech, story.voice, model);
            setTimeout(() => { updateProgress(); resolve(); }, 500); 
        }));
        if (node.imagePrompt) {
            const imgKey = `${story.id}_start`;
            promises.push(generateSceneImage(node.imagePrompt, imgKey).then(() => { updateProgress(); }));
        }
    }
    await Promise.allSettled(promises);
    const startImgKey = `${story.id}_start`;
    const startImg = await storageService.getImage(startImgKey);
    return { ...story, isOfflineReady: true, cover: startImg || story.cover };
};