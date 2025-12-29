import React, { useMemo } from 'react';
import { UserStats, ReportData } from '../types';
import { 
    Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
    Tooltip
} from 'recharts';

interface ChatDataDashboardProps {
    userStats: UserStats;
    reportData: ReportData | null;
    statDeltas?: Partial<UserStats>;
}

// Configuration for the 6 Dimensions
const TRAIT_CONFIG: Record<string, { label: string; color: string; bg: string; text: string }> = {
    confidence: { label: '自信', color: '#3b82f6', bg: 'bg-blue-500', text: 'text-blue-600' },
    social: { label: '社交', color: '#ec4899', bg: 'bg-pink-500', text: 'text-pink-600' },
    logic: { label: '逻辑', color: '#eab308', bg: 'bg-yellow-500', text: 'text-yellow-600' },
    resilience: { label: '抗挫', color: '#ef4444', bg: 'bg-red-500', text: 'text-red-600' },
    independence: { label: '独立', color: '#22c55e', bg: 'bg-green-500', text: 'text-green-600' },
    creativity: { label: '创造', color: '#a855f7', bg: 'bg-purple-500', text: 'text-purple-600' },
};

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white p-3 border border-slate-100 shadow-xl rounded-xl text-xs z-50">
                <p className="font-bold text-slate-800 mb-2 border-b border-slate-100 pb-1">{label}</p>
                {payload.map((entry: any, index: number) => (
                    <div key={index} className="flex items-center gap-2 mb-1 last:mb-0">
                        <span className="w-2 h-2 rounded-full" style={{backgroundColor: entry.color}}></span>
                        <span className="text-slate-500">{entry.name}:</span>
                        <span className="font-mono font-bold" style={{ color: entry.color }}>{entry.value}</span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

export const ChatDataDashboard: React.FC<ChatDataDashboardProps> = ({ userStats, reportData, statDeltas = {} }) => {
    
    // 1. Prepare Radar Data (Previous vs Current)
    const radarData = useMemo(() => {
        return Object.keys(TRAIT_CONFIG).map(key => {
            const current = userStats[key] || 0;
            const delta = statDeltas[key] || 0;
            const previous = Math.max(0, current - delta); // Calculate previous state
            return {
                subject: TRAIT_CONFIG[key].label,
                A: current,   // Current (Blue)
                B: previous,  // Previous (Gray)
                fullMark: 100
            };
        });
    }, [userStats, statDeltas]);

    // 2. Filter Active Growth Traits
    const activeGrowthKeys = useMemo(() => {
        return Object.keys(statDeltas).filter(key => (statDeltas[key] || 0) > 0);
    }, [statDeltas]);

    // 3. Evidence / Quote List
    const evidenceList = useMemo(() => {
        if (!reportData?.evidencePoints) return [];
        return reportData.evidencePoints.slice(0, 3);
    }, [reportData]);

    return (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full group hover:shadow-md transition-shadow duration-300">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div>
                    <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                        <span className="material-symbols-outlined text-brand-500">monitoring</span>
                        成长数据
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">本局游戏能力分析</p>
                </div>
                {activeGrowthKeys.length > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded-full animate-pulse">
                        <span className="material-symbols-outlined text-[12px]">trending_up</span>
                        <span>能力提升</span>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-8">
                
                {/* 1. Layered Radar Chart: Visualizing Expansion */}
                <div className="relative">
                    <div className="flex justify-between items-center mb-[-10px] px-2 relative z-10">
                         <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">能力雷达</h4>
                         {activeGrowthKeys.length > 0 && (
                            <div className="flex gap-3 text-[10px]">
                                <div className="flex items-center gap-1 text-slate-400">
                                    <span className="w-2 h-2 rounded-full bg-slate-300"></span> 之前
                                </div>
                                <div className="flex items-center gap-1 text-brand-600 font-bold">
                                    <span className="w-2 h-2 rounded-full bg-brand-500"></span> 现在
                                </div>
                            </div>
                         )}
                    </div>
                    <div className="h-64 -ml-2 w-[105%]">
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                                <PolarGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 700 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                {/* Previous State (Gray) */}
                                <Radar
                                    name="之前"
                                    dataKey="B"
                                    stroke="#cbd5e1"
                                    strokeWidth={2}
                                    fill="#cbd5e1"
                                    fillOpacity={0.3}
                                />
                                {/* Current State (Blue) */}
                                <Radar
                                    name="现在"
                                    dataKey="A"
                                    stroke="#0ea5e9"
                                    strokeWidth={2}
                                    fill="#0ea5e9"
                                    fillOpacity={0.4}
                                />
                                <Tooltip content={<CustomTooltip />} />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 2. Growth Progress Bars (RPG Style) */}
                {activeGrowthKeys.length > 0 ? (
                    <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100">
                        <div className="flex justify-between items-center mb-4">
                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <span className="material-symbols-outlined text-[14px]">bolt</span>
                                本局经验值获取
                            </h4>
                        </div>
                        <div className="space-y-4">
                            {activeGrowthKeys.map(key => {
                                const delta = statDeltas[key] || 0;
                                const current = userStats[key] || 0;
                                const prev = Math.max(0, current - delta);
                                const trait = TRAIT_CONFIG[key];
                                
                                return (
                                    <div key={key}>
                                        <div className="flex justify-between items-end text-xs mb-1.5">
                                            <span className={`font-bold ${trait.text} flex items-center gap-1`}>
                                                {trait.label}
                                                <span className="bg-white px-1.5 rounded-full text-[9px] border shadow-sm">Lv.{Math.floor(current/10)}</span>
                                            </span>
                                            <div className="flex items-baseline font-mono">
                                                <span className="text-slate-400 text-[10px]">{prev}</span>
                                                <span className="mx-1 text-slate-300 text-[10px]">→</span>
                                                <span className="font-bold text-slate-700">{current}</span>
                                                <span className="ml-1.5 font-bold text-green-500 animate-pulse">+{delta}</span>
                                            </div>
                                        </div>
                                        {/* Progress Track */}
                                        <div className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden flex shadow-inner">
                                            {/* Previous Value */}
                                            <div 
                                                style={{ width: `${prev}%` }} 
                                                className={`h-full ${trait.bg} opacity-60 transition-all duration-1000`}
                                            ></div>
                                            {/* Delta (Animated) */}
                                            <div 
                                                style={{ width: `${Math.max(delta, 2)}%` }} // Min width 2% for visibility
                                                className={`h-full ${trait.bg} relative overflow-hidden`}
                                            >
                                                <div className="absolute inset-0 bg-white/30 animate-[pulse_1s_ease-in-out_infinite]"></div>
                                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent w-full -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100 border-dashed">
                        <p className="text-xs text-slate-400">暂无数据变动，继续探索故事吧！</p>
                    </div>
                )}

                {/* 3. Highlight Quote & Insight */}
                {reportData?.highlightQuote && (
                    <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 rounded-xl p-4 shadow-sm relative overflow-hidden">
                        <div className="flex items-center gap-2 mb-2 text-orange-600">
                             <span className="material-symbols-outlined text-lg">psychology</span>
                             <h4 className="text-xs font-bold uppercase">心声洞察</h4>
                        </div>
                        <p className="text-sm text-slate-700 italic leading-relaxed mb-2 relative z-10">
                            "{reportData.highlightQuote}"
                        </p>
                        <div className="h-px bg-orange-200/50 w-full my-2"></div>
                        <p className="text-xs text-orange-800/80 leading-snug">
                            {reportData.highlightAnalysis || "孩子在选择中展现了潜意识的倾向。"}
                        </p>
                        <span className="material-symbols-outlined absolute -bottom-2 -right-2 text-6xl text-orange-100 opacity-50 pointer-events-none">format_quote</span>
                    </div>
                )}
            </div>
        </div>
    );
};