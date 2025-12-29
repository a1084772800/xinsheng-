
import React from 'react';
import { Story } from '../types';
import { initializeAudio } from '../services/geminiService';

interface ChildLibraryProps {
    stories: Story[];
    onPlay: (storyId: string) => void;
}

export const ChildLibrary: React.FC<ChildLibraryProps> = ({ stories, onPlay }) => {
    
    // Unlock audio then play
    const handlePlay = (storyId: string) => {
        initializeAudio();
        onPlay(storyId);
    };

    return (
        <div className="absolute inset-0 overflow-y-auto bg-[#fff1f2] p-6 lg:p-10 custom-scrollbar">
            <div className="max-w-7xl mx-auto">
                <header className="mb-10 flex items-center gap-5 select-none">
                    <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-lg border-4 border-yellow-200 transform -rotate-6">
                        <span className="material-symbols-outlined text-5xl text-yellow-500">auto_stories</span>
                    </div>
                    <div>
                        <h1 className="text-4xl font-bold text-slate-800 tracking-tight mb-2">我的故事书</h1>
                        <p className="text-slate-500 font-bold bg-white/60 px-3 py-1 rounded-full inline-block">
                            一共藏着 {stories.length} 个好听的故事
                        </p>
                    </div>
                </header>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 pb-20">
                    {stories.map(story => (
                        <button 
                            key={story.id}
                            onClick={() => handlePlay(story.id)}
                            className="group relative bg-white rounded-[2rem] p-4 shadow-sm hover:shadow-xl hover:-translate-y-2 transition-all duration-300 text-left flex flex-col h-full border-2 border-transparent hover:border-brand-200"
                        >
                            <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden mb-5 bg-slate-100 shadow-inner">
                                <img 
                                    src={story.cover} 
                                    alt={story.title} 
                                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                />
                                {/* Play overlay */}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-lg transform scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-300 text-brand-500">
                                        <span className="material-symbols-outlined text-4xl ml-1">play_arrow</span>
                                    </div>
                                </div>
                                
                                {/* Badges */}
                                <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                                    {story.isOfflineReady && (
                                        <span className="bg-green-500 text-white text-[10px] font-black px-2 py-1 rounded-lg shadow-sm flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[12px]">wifi_off</span>
                                            无需流量
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="px-1 pb-2 flex-1 flex flex-col">
                                <h3 className="text-2xl font-bold text-slate-800 mb-2 leading-tight group-hover:text-brand-600 transition-colors line-clamp-2">
                                    {story.title}
                                </h3>
                                <div className="mt-auto flex items-center justify-between opacity-60 group-hover:opacity-100 transition-opacity">
                                    <span className="text-xs font-bold bg-brand-50 text-brand-700 px-2.5 py-1 rounded-md border border-brand-100">
                                        {story.topic}
                                    </span>
                                    <span className="text-xs text-slate-400 font-bold flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[14px]">calendar_today</span>
                                        {story.date}
                                    </span>
                                </div>
                            </div>
                        </button>
                    ))}

                    {/* Create New Placeholder / Empty State */}
                    {stories.length === 0 && (
                         <div className="col-span-full flex flex-col items-center justify-center py-24 text-slate-400 border-4 border-dashed border-slate-200 rounded-[3rem] bg-white/50">
                            <span className="material-symbols-outlined text-8xl mb-6 text-slate-300">import_contacts</span>
                            <p className="text-2xl font-bold text-slate-500 mb-2">书架是空的哦</p>
                            <p className="font-medium">快去让爸爸妈妈帮你变一个故事出来吧！</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
