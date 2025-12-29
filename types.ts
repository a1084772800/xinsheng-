
export interface StoryOption {
    label: string;
    text: string;
    keywords?: string[];
    next: string;
    type: string; // Allow flexible strings from AI
}

export interface StoryNode {
    id: string;
    text: string;
    audioText?: string;
    imagePrompt: string;
    type: 'choice' | 'linear' | 'end'; // Added 'linear'
    next?: string; // For linear nodes to auto-advance
    question?: string;
    options?: StoryOption[];
}

export interface Story {
    id: string;
    title: string;
    cover: string;
    topic: string; // Keep for display
    goal: string;  // Keep for display/metadata
    voice: string; // Selected voice name
    style: string; // Story style
    ttsModel?: string; // New: Specific TTS model used
    // playbackSpeed removed
    date: string;
    status: 'draft' | 'completed';
    nodes: Record<string, StoryNode>; 
    insight?: string;
    tags: string[];
    isOfflineReady?: boolean;
}

export interface UserStats {
    confidence: number;    // Replaces Security
    social: number;        // Replaces Empathy
    logic: number;         // Replaces Honesty
    resilience: number;    // Kept (AQ)
    independence: number;  // Kept
    creativity: number;    // Replaces Imagination
    [key: string]: number; // Allow index signature for dynamic access
}

export interface UserChoice {
    step: string;
    selection: string;
    type: string;
    transcript?: string; // The specific command that triggered the choice
    speechHistory?: string[]; // NEW: All spoken phrases at this step
}

// New Interface for specific psychological mapping evidence
export interface PsychologicalEvidence {
    trait: string; // e.g. "Confidence"
    quote: string; // What the child said
    context: string; // The story situation
    analysis: string; // Deep psychological interpretation
    timestamp: number;
}

// New Interface for the Advanced Report
export interface ReportDimension {
    subject: string; // e.g., "Social", "Logic"
    score: number; // The performance score in this specific story (0-100)
    delta: number; // The change applied to the long-term stats (e.g. +5, -2)
    reason: string; // Brief reason for the change
}

export interface ReportData {
    summary: string;
    traitAnalysis: string; // Deep text analysis
    suggestion: string;
    dimensions: ReportDimension[]; // For Radar Chart & Stats Update
    highlightQuote?: string; // The most revealing thing the child said
    highlightAnalysis?: string; // Analysis of that quote
    keywords: string[]; // 3-4 keywords describing the state (e.g. "Brave", "Hesitant")
    evidencePoints?: PsychologicalEvidence[]; // NEW: Detailed breakdown of conversation to traits
}
