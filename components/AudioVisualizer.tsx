import React from 'react';

interface AudioVisualizerProps {
    isActive: boolean;
    color?: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, color = 'bg-brand-500' }) => {
    if (!isActive) return null;

    return (
        <div className="flex gap-1.5 items-center justify-center h-8">
            <div className={`w-1.5 h-3 ${color} rounded-full animate-sound-wave`}></div>
            <div className={`w-1.5 h-5 ${color} rounded-full animate-sound-wave`} style={{ animationDelay: '0.1s' }}></div>
            <div className={`w-1.5 h-3 ${color} rounded-full animate-sound-wave`} style={{ animationDelay: '0.2s' }}></div>
            <div className={`w-1.5 h-6 ${color} rounded-full animate-sound-wave`} style={{ animationDelay: '0.15s' }}></div>
            <div className={`w-1.5 h-4 ${color} rounded-full animate-sound-wave`} style={{ animationDelay: '0.3s' }}></div>
        </div>
    );
};
