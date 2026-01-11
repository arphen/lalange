import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export const Manual = () => {
  return (
    <div className="w-full h-full overflow-y-auto bg-basalt text-gray-300 font-mono p-8 md:p-12 lg:p-16">
      <div className="max-w-3xl mx-auto space-y-12 pb-24">
        {/* Header */}
        <div className="space-y-6 border-b border-white/10 pb-8">
          <Link to="/" className="inline-flex items-center text-xs text-lacan-red hover:text-white transition-colors mb-4 uppercase tracking-widest">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Return to Cockpit
          </Link>
          <h1 className="text-3xl md:text-5xl font-bold text-white tracking-tight leading-tight">
            Field Manual <br/>
            <span className="text-dune-gold">Pilot Training</span>
          </h1>
          <p className="text-lg text-gray-500 font-mono uppercase tracking-widest">
            Operating Protocol v1.0
          </p>
        </div>

        {/* Introduction */}
        <div className="prose prose-invert max-w-none">
            <p className="text-xl leading-relaxed text-white/90">
                Operating Arphen requires training. The pilot must unlearn the habits of "passive" reading. 
                This manual outlines the core techniques required for high-velocity neuro-semantic ingestion.
            </p>
        </div>

        {/* Section 1 */}
        <section className="space-y-4">
            <div className="flex items-center gap-4">
                <span className="text-4xl font-bold text-white/10">01</span>
                <h2 className="text-xl font-bold text-dune-gold uppercase tracking-wider">The Gaze (Saccade Anchoring)</h2>
            </div>
            <div className="pl-12 space-y-4">
                <p className="leading-relaxed">
                    Do not chase the words. Simply relax your eyes and focus where it feels natural.
                </p>
                <p className="leading-relaxed">
                    Arphen uses <strong>"Gradient Anchoring"</strong> (a continuous font-weight gradient) to guide your saccades. 
                    Trust the stream; let the text wash over the fovea. Your eyes should remain static while the semantic content moves.
                </p>
            </div>
        </section>

        {/* Section 2 */}
        <section className="space-y-4">
            <div className="flex items-center gap-4">
                <span className="text-4xl font-bold text-white/10">02</span>
                <h2 className="text-xl font-bold text-dune-gold uppercase tracking-wider">Managing the Flow</h2>
            </div>
             <div className="pl-12 space-y-6">
                <div>
                    <h3 className="text-white font-bold mb-2">The River of Text</h3>
                    <p className="leading-relaxed text-gray-400">
                        Use peripheral vision. The ghost lines above and below the central stream provide crucial context. 
                        <strong>Darker words</strong> in the river signal upcoming high-density/entropy sections. Prepare your mind for impact.
                    </p>
                </div>
                <div>
                    <h3 className="text-white font-bold mb-2">The Karaoke Pause</h3>
                    <p className="leading-relaxed text-gray-400">
                        If you lose the thread, simply <strong>hover the mouse</strong> (or tap) anywhere on the stream. 
                        This instantly halts the flow and brightens the context lines. 
                        Usage of this "Karaoke Mode" allows instant regression without losing your place. Click the word to resume.
                    </p>
                </div>
            </div>
        </section>

        {/* Section 3 */}
        <section className="space-y-4">
            <div className="flex items-center gap-4">
                <span className="text-4xl font-bold text-white/10">03</span>
                <h2 className="text-xl font-bold text-dune-gold uppercase tracking-wider">Cognitive Endurance</h2>
            </div>
            <div className="pl-12 space-y-4">
                <p className="leading-relaxed">
                    High-velocity ingestion is exhausting. The system is designed to induce <em>jouissance</em>—a pleasurable pain.
                </p>
                <p className="leading-relaxed">
                    Limit initial sessions to <strong>15-20 minutes</strong>. The "Lacanian Cut" (entropy braking) will help regulate your tempo, 
                    but you must actively maintain focus. You are not reading; you are processing.
                </p>
            </div>
        </section>

        <div className="pt-12 border-t border-white/10 mt-8">
          <p className="text-xs text-center text-gray-600 uppercase tracking-widest">
            End of Manual
          </p>
        </div>
      </div>
    </div>
  );
};
