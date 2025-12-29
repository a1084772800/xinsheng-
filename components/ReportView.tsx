
import React from 'react';
import { createPortal } from 'react-dom';
import { ReportData } from '../types';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';

interface ReportViewProps {
    report: ReportData;
    onClose: () => void;
}

export const ReportView: React.FC<ReportViewProps> = ({ report, onClose }) => {
    // Transform dimension subject names for display
    // Map English keys from AI to Chinese labels
    const dimMap: Record<string, string> = {
        "Confidence": "自信表达",
        "Social": "社交情商",
        "Logic": "逻辑思辨",
        "Resilience": "抗挫逆商",
        "Independence": "独立决策",
        "Creativity": "创造想象"
    };

    const chartData = report.dimensions.map(d => ({
        subject: dimMap[d.subject] || d.subject,
        A: d.score,
        fullMark: 100,
    }));

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-scale-up flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-500 to-accent-500 p-6 text-white text-center relative flex-none">
                    <span className="material-symbols-outlined text-5xl mb-2 opacity-90">psychology_alt</span>
                    <h2 className="text-2xl font-bold">成长洞察报告</h2>
                    <p className="opacity-90 text-sm">基于 AI 深度语义分析与行为心理学</p>
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors">
                        <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                </div>
                
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 custom-scrollbar">
                    
                    {/* Top Section: Radar Chart & Keywords */}
                    <div className="flex flex-col md:flex-row gap-8 items-center">
                        {/* Radar Chart */}
                        <div className="w-full md:w-1/2 h-64 relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
                                    <PolarGrid stroke="#e2e8f0" />
                                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }} />
                                    <Radar
                                        name="能力模型"
                                        dataKey="A"
                                        stroke="#0ea5e9"
                                        fill="#0ea5e9"
                                        fillOpacity={0.4}
                                    />
                                </RadarChart>
                            </ResponsiveContainer>
                            <div className="absolute top-0 right-0 bg-slate-50 text-[10px] text-slate-400 px-2 py-1 rounded">六维成长模型</div>
                        </div>

                        {/* Keywords & Quick Summary */}
                        <div className="w-full md:w-1/2 space-y-4">
                             <div>
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">当前状态关键词</h3>
                                <div className="flex flex-wrap gap-2">
                                    {report.keywords && report.keywords.length > 0 ? (
                                        report.keywords.map((kw, i) => (
                                            <span key={i} className="px-3 py-1 bg-brand-50 text-brand-600 rounded-full text-sm font-bold shadow-sm border border-brand-100">
                                                {kw}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-slate-400 text-sm">分析中...</span>
                                    )}
                                </div>
                             </div>
                             <div>
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">故事回顾</h3>
                                <p className="text-slate-600 text-sm leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    {report.summary}
                                </p>
                             </div>
                        </div>
                    </div>

                    <div className="h-px bg-slate-100 w-full"></div>

                    {/* Highlight Quote Analysis (New Feature) */}
                    {report.highlightQuote && (
                        <div className="bg-accent-50 rounded-2xl p-5 border border-accent-100 relative overflow-hidden">
                             <span className="material-symbols-outlined absolute top-[-10px] right-[-10px] text-8xl text-accent-100 opacity-50">format_quote</span>
                             <div className="relative z-10">
                                <h3 className="flex items-center gap-2 text-accent-700 font-bold mb-3">
                                    <span className="material-symbols-outlined">record_voice_over</span>
                                    心声解码
                                </h3>
                                <div className="text-xl font-serif text-slate-800 italic mb-3 pl-4 border-l-4 border-accent-300">
                                    "{report.highlightQuote}"
                                </div>
                                <p className="text-sm text-slate-600 leading-relaxed">
                                    <span className="font-bold text-accent-600">心理映射：</span>
                                    {report.highlightAnalysis || "这显示了孩子在面对选择时的真实潜意识反应。"}
                                </p>
                             </div>
                        </div>
                    )}

                    {/* Deep Analysis */}
                    <div>
                        <div className="flex items-center gap-2 mb-3 text-brand-600 font-bold text-lg">
                            <span className="material-symbols-outlined">analytics</span>
                            <h3>深度心理剖析</h3>
                        </div>
                        <p className="text-slate-600 leading-relaxed text-justify">
                            {report.traitAnalysis}
                        </p>
                    </div>

                    {/* Advice */}
                    <div className="bg-yellow-50 border border-yellow-100 p-5 rounded-2xl">
                        <div className="flex items-center gap-2 mb-2 text-yellow-700 font-bold text-lg">
                            <span className="material-symbols-outlined">lightbulb</span>
                            <h3>给家长的建议</h3>
                        </div>
                        <p className="text-slate-700 font-medium italic leading-relaxed">
                            "{report.suggestion}"
                        </p>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex-none">
                    <button 
                        onClick={onClose}
                        className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg hover:shadow-xl active:scale-[0.99]"
                    >
                        收下这份报告 (返回主页)
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
