import React from 'react';
import { useAIStore } from '../../core/store/ai';
import { reloadModel } from '../../core/ai/service';

export const ModelStatus: React.FC = () => {
    const { 
        isReady, 
        isLoading, 
        activeModelName, 
        activity, 
        progress, 
        progressValue, 
        error, 
        tps 
    } = useAIStore();

    const handleReload = async () => {
        if (confirm('Reload the AI model? This will clear the current session cache.')) {
            try {
                await reloadModel();
            } catch (e) {
                console.error(e);
            }
        }
    };

    // Determine status color
    let statusColor = 'bg-gray-500';
    if (error) statusColor = 'bg-red-500';
    else if (isLoading) statusColor = 'bg-yellow-500 animate-pulse';
    else if (isReady) statusColor = 'bg-green-500';

    return (
        <div className="bg-white/5 border border-white/10 rounded-lg p-4 font-mono text-xs">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${statusColor}`}></div>
                    <span className="font-bold text-gray-300 uppercase tracking-wider">
                        {isLoading ? 'INITIALIZING...' : (error ? 'SYSTEM FAILURE' : 'NEURAL ENGINE')}
                    </span>
                </div>
                <button 
                    onClick={handleReload}
                    disabled={isLoading}
                    className="text-gray-500 hover:text-dune-gold disabled:opacity-50 transition-colors"
                    title="Reload Model"
                >
                    [ RELOAD ]
                </button>
            </div>

            {error ? (
                <div className="text-red-400 mb-2 border border-red-500/20 bg-red-500/10 p-2 rounded">
                    ERROR: {error}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                            <div className="text-gray-500 mb-1">ACTIVE MODEL</div>
                            <div className="text-dune-gold truncate" title={activeModelName || 'None'}>
                                {activeModelName || '---'}
                            </div>
                        </div>
                        <div>
                            <div className="text-gray-500 mb-1">PERFORMANCE</div>
                            <div className="text-dune-gold">
                                {tps > 0 ? `${tps.toFixed(1)} TPS` : 'IDLE'}
                            </div>
                        </div>
                    </div>

                    {isLoading && (
                        <div className="mb-2">
                            <div className="flex justify-between text-gray-400 mb-1">
                                <span>{progress || 'Loading...'}</span>
                                <span>{Math.round(progressValue * 100)}%</span>
                            </div>
                            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-dune-gold transition-all duration-300"
                                    style={{ width: `${progressValue * 100}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {activity && !isLoading && (
                        <div className="flex items-center gap-2 text-magma-vent animate-pulse">
                            <span className="w-1.5 h-1.5 bg-magma-vent rounded-full"></span>
                            {activity}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
