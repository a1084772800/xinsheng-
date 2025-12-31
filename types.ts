export interface StoryOption {
    label: string;
    text: string; // What the character/child says
    next: string;
    analysis?: string; // Why this option shows understanding/imagination
}

export interface StoryNode {
    id: string;
    text: string; // Main story text
    audioText?: string;
    
    // Picture Book Specifics
    narrativeGoal?: string; // Purpose of this page
    visual: string; // Detailed visual description for AI
    layout?: string; // Composition suggestion
    
    type: 'choice' | 'linear' | 'end';
    next?: string;
    question?: string; // Deep understanding question
    options?: StoryOption[];
    
    imagePrompt: string; // The final prompt sent to Imagen
    
    // Compatibility
    sceneDescriptionEN?: string;
}

export interface Story {
    id: string;
    title: string;
    cover: string;
    topic: string;
    goal: string; 
    voice: string;
    style: string;
    styleInstructions?: string; // Global style config for consistency
    ttsModel?: string;
    date: string;
    status: 'draft' | 'completed';
    nodes: Record<string, StoryNode>; 
    tags: string[];
    isOfflineReady?: boolean;
}

export interface UserChoice {
    step: string;
    selection: string;
    type: string; // Now used for general category of interaction
    transcript?: string;
    speechHistory?: string[];
}

export interface UserStats {
    [key: string]: number;
}

export interface ReportDimension {
    subject: string;
    score: number;
}

export interface ReportData {
    dimensions: ReportDimension[];
    keywords: string[];
    summary: string;
    highlightQuote?: string;
    highlightAnalysis?: string;
    traitAnalysis: string;
    suggestion: string;
}