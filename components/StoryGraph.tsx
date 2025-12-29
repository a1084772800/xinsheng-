
import React, { useMemo } from 'react';
import { StoryNode } from '../types';

interface StoryGraphProps {
    nodes: Record<string, StoryNode>;
    startNodeId: string;
}

// Layout configuration
const CONFIG = {
    NODE_WIDTH: 180,
    NODE_HEIGHT: 60,
    X_GAP: 80,
    Y_GAP: 20,
};

interface GraphNode extends StoryNode {
    x: number;
    y: number;
    depth: number;
}

interface GraphEdge {
    source: { x: number; y: number; id: string };
    target: { x: number; y: number; id: string };
    label: string;
}

export const StoryGraph: React.FC<StoryGraphProps> = ({ nodes, startNodeId }) => {
    
    // Calculate Layout Logic (Simple Layered Layout)
    const { graphNodes, graphEdges, bounds } = useMemo(() => {
        const processedNodes: Record<string, GraphNode> = {};
        const edges: GraphEdge[] = [];
        const levels: Record<number, string[]> = {};
        const visited = new Set<string>();

        // 1. BFS to determine depth (layers)
        const queue: { id: string; depth: number }[] = [{ id: startNodeId, depth: 0 }];
        
        while (queue.length > 0) {
            const { id, depth } = queue.shift()!;
            if (visited.has(id)) continue;
            visited.add(id);

            // Add to levels
            if (!levels[depth]) levels[depth] = [];
            levels[depth].push(id);

            // Process children
            const node = nodes[id];
            
            // Handle Linear Flow
            if (node.type === 'linear' && node.next) {
                 if (nodes[node.next]) {
                     queue.push({ id: node.next, depth: depth + 1 });
                 }
            } 
            // Handle Branching Flow
            else if (node.type === 'choice' && node.options) {
                node.options.forEach(opt => {
                    if (nodes[opt.next]) {
                        queue.push({ id: opt.next, depth: depth + 1 });
                    }
                });
            }
        }

        // 2. Calculate X, Y coordinates
        let maxY = 0;
        Object.keys(levels).forEach(depthStr => {
            const depth = parseInt(depthStr);
            const levelNodes = levels[depth];
            // const levelHeight = levelNodes.length * (CONFIG.NODE_HEIGHT + CONFIG.Y_GAP) - CONFIG.Y_GAP;
            
            levelNodes.forEach((nodeId, index) => {
                const node = nodes[nodeId];
                const x = depth * (CONFIG.NODE_WIDTH + CONFIG.X_GAP) + 50; // 50 padding left
                
                const startY = 50; // Padding top
                const y = startY + index * (CONFIG.NODE_HEIGHT + CONFIG.Y_GAP);

                processedNodes[nodeId] = { ...node, x, y, depth };
                maxY = Math.max(maxY, y + CONFIG.NODE_HEIGHT);
            });
        });

        // 3. Generate Edges with coordinates
        Object.values(processedNodes).forEach(node => {
            if (node.type === 'linear' && node.next) {
                 const targetNode = processedNodes[node.next];
                 if (targetNode) {
                    edges.push({
                        source: { x: node.x, y: node.y, id: node.id },
                        target: { x: targetNode.x, y: targetNode.y, id: targetNode.id },
                        label: 'Next'
                    });
                 }
            }
            else if (node.type === 'choice' && node.options) {
                node.options.forEach(opt => {
                    const targetNode = processedNodes[opt.next];
                    if (targetNode) {
                        edges.push({
                            source: { x: node.x, y: node.y, id: node.id },
                            target: { x: targetNode.x, y: targetNode.y, id: targetNode.id },
                            label: opt.label
                        });
                    }
                });
            }
        });

        // Calculate Canvas Size
        const maxX = (Math.max(...Object.keys(levels).map(Number)) + 1) * (CONFIG.NODE_WIDTH + CONFIG.X_GAP) + 50;
        
        return {
            graphNodes: Object.values(processedNodes),
            graphEdges: edges,
            bounds: { width: Math.max(800, maxX), height: Math.max(400, maxY + 100) }
        };
    }, [nodes, startNodeId]);

    return (
        <div className="w-full h-full overflow-auto bg-slate-50 relative custom-scrollbar">
            <div 
                className="relative" 
                style={{ width: bounds.width, height: bounds.height }}
            >
                {/* 1. Connections Layer (SVG) */}
                <svg className="absolute inset-0 pointer-events-none z-0" width={bounds.width} height={bounds.height}>
                    <defs>
                        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                            <polygon points="0 0, 10 3.5, 0 7" fill="#cbd5e1" />
                        </marker>
                    </defs>
                    {graphEdges.map((edge, i) => {
                        const startX = edge.source.x + CONFIG.NODE_WIDTH;
                        const startY = edge.source.y + CONFIG.NODE_HEIGHT / 2;
                        const endX = edge.target.x;
                        const endY = edge.target.y + CONFIG.NODE_HEIGHT / 2;
                        
                        // Bézier curve control points
                        const controlPoint1X = startX + (endX - startX) / 2;
                        const controlPoint1Y = startY;
                        const controlPoint2X = startX + (endX - startX) / 2;
                        const controlPoint2Y = endY;

                        return (
                            <g key={i}>
                                <path 
                                    d={`M ${startX} ${startY} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${endX} ${endY}`}
                                    fill="none"
                                    stroke={edge.label === 'Next' ? '#cbd5e1' : '#cbd5e1'}
                                    strokeWidth={edge.label === 'Next' ? "1" : "2"}
                                    strokeDasharray={edge.label === 'Next' ? "4 4" : "0"}
                                    markerEnd="url(#arrowhead)"
                                />
                                {/* Edge Label Pill */}
                                {edge.label !== 'Next' && (
                                    <foreignObject 
                                        x={(startX + endX) / 2 - 40} 
                                        y={(startY + endY) / 2 - 12} 
                                        width="80" 
                                        height="24"
                                    >
                                        <div className="flex items-center justify-center h-full">
                                            <span className="bg-white border border-slate-200 text-[9px] text-slate-500 px-2 py-0.5 rounded-full shadow-sm truncate max-w-full">
                                                {edge.label}
                                            </span>
                                        </div>
                                    </foreignObject>
                                )}
                            </g>
                        );
                    })}
                </svg>

                {/* 2. Nodes Layer (HTML) */}
                {graphNodes.map((node) => {
                    // Node Styling
                    let borderColor = 'border-slate-200';
                    let bgColor = 'bg-white';
                    let textColor = 'text-slate-600';
                    let icon = 'article';
                    
                    if (node.id === startNodeId) {
                        borderColor = 'border-brand-300';
                        bgColor = 'bg-brand-50';
                        textColor = 'text-brand-700';
                        icon = 'flag';
                    } else if (node.type === 'end') {
                        borderColor = 'border-green-300';
                        bgColor = 'bg-green-50';
                        textColor = 'text-green-700';
                        icon = 'check_circle';
                    } else if (node.type === 'choice') {
                        borderColor = 'border-amber-300';
                        bgColor = 'bg-amber-50';
                        textColor = 'text-amber-700';
                        icon = 'call_split';
                    } else if (node.type === 'linear') {
                        borderColor = 'border-blue-200';
                        bgColor = 'bg-blue-50';
                        textColor = 'text-blue-600';
                        icon = 'arrow_forward';
                    }

                    return (
                        <div
                            key={node.id}
                            className={`
                                absolute flex items-center p-3 rounded-xl border-2 shadow-sm transition-all duration-300 group z-10
                                hover:shadow-lg hover:scale-105 hover:z-20 cursor-default
                                ${borderColor} ${bgColor}
                            `}
                            style={{
                                width: CONFIG.NODE_WIDTH,
                                height: CONFIG.NODE_HEIGHT,
                                left: node.x,
                                top: node.y,
                            }}
                        >
                            <div className={`
                                w-8 h-8 rounded-lg flex items-center justify-center mr-3 flex-none
                                ${node.id === startNodeId ? 'bg-brand-200 text-brand-700' : 
                                  node.type === 'end' ? 'bg-green-200 text-green-700' : 
                                  node.type === 'choice' ? 'bg-amber-100 text-amber-600' :
                                  'bg-white border border-slate-100 text-slate-400'}
                            `}>
                                <span className="material-symbols-outlined text-lg">{icon}</span>
                            </div>
                            
                            <div className="min-w-0 flex-1">
                                <div className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${textColor}`}>
                                    {node.type === 'end' ? 'Ending' : node.id === startNodeId ? 'Start' : node.type === 'linear' ? 'Scene' : 'Choice'}
                                </div>
                                <div className="text-xs font-bold text-slate-800 truncate">
                                    {node.text}
                                </div>
                            </div>

                            {/* Hover Tooltip for Full Detail */}
                            <div className="absolute left-1/2 -bottom-2 transform -translate-x-1/2 translate-y-full w-64 bg-slate-800 text-white text-xs p-3 rounded-xl shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center">
                                <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-slate-800 rotate-45"></div>
                                <p className="leading-relaxed mb-2">{node.text}</p>
                                {node.question && (
                                    <p className="text-brand-300 font-bold border-t border-slate-600 pt-2 mt-2">Q: {node.question}</p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
