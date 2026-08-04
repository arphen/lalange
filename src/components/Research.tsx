import { useState } from 'react';
import { clsx } from 'clsx';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { SeoHead } from './SeoHead';

type Section = 'intro' | 'psychoanalysis' | 'architecture' | 'network' | 'ethics';

const NavButton = ({ section, label, active, onClick }: { section: Section; label: string; active: boolean; onClick: (s: Section) => void }) => (
    <button
      onClick={() => onClick(section)}
      className={clsx(
        "text-left px-4 py-2 border-l-2 transition-all duration-300 font-mono text-xs uppercase tracking-widest",
        active
          ? "border-lacan-red text-white bg-white/5"
          : "border-white/10 text-gray-500 hover:text-white hover:border-white/30"
      )}
    >
      {label}
    </button>
  );

export const Research = () => {
  const [activeSection, setActiveSection] = useState<Section>('intro');



  return (
    <div className="w-full h-full overflow-hidden bg-basalt text-gray-300 font-mono flex flex-col md:flex-row">
      <SeoHead
          title="Research"
          description="Technical and theoretical analysis of Arphen: The Neuro-Semantic Scansion Engine."
          canonicalUrl="https://arphen.xyz/research"
      />
        
      {/* Sidebar Navigation */}
      <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/10 p-6 flex flex-col shrink-0 bg-black/20">
        <Link to="/" className="inline-flex items-center text-xs text-lacan-red hover:text-white transition-colors mb-8 uppercase tracking-widest">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Cockpit
        </Link>
        <div className="text-xs text-gray-600 uppercase tracking-widest mb-4 font-bold">Table of Contents</div>
        <div className="flex flex-col gap-1">
            <NavButton section="intro" label="01. Intervention" active={activeSection === 'intro'} onClick={setActiveSection} />
            <NavButton section="psychoanalysis" label="02. The Exigent Sadist" active={activeSection === 'psychoanalysis'} onClick={setActiveSection} />
            <NavButton section="architecture" label="03. Local-First AI" active={activeSection === 'architecture'} onClick={setActiveSection} />
            <NavButton section="network" label="04. The Synapse" active={activeSection === 'network'} onClick={setActiveSection} />
            <NavButton section="ethics" label="05. The Librarian" active={activeSection === 'ethics'} onClick={setActiveSection} />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 md:p-12 lg:p-16 scroll-smooth">
        <div className="max-w-3xl mx-auto space-y-16 pb-24">
            
            {/* Header */}
            <div className="space-y-4 border-b border-white/10 pb-8">
                <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight leading-tight">
                    Arphen: The Neuro-Semantic <br/> <span className="text-lacan-red">Scansion Engine</span>
                </h1>
                <p className="text-sm text-gray-500 font-mono uppercase tracking-widest">
                    Technical & Theoretical Analysis // v1.0
                </p>
            </div>

            {activeSection === 'intro' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-dune-gold uppercase tracking-wider">1. The Neuro-Semantic Intervention</h2>
                        <p className="leading-relaxed text-lg">
                            The Arphen project represents a radical departure from the prevailing paradigms of digital text consumption. 
                            Defined not as an "e-reader" but as a "neuro-semantic instrument," Arphen intervenes in the attention economy 
                            by fundamentally restructuring the mechanical act of reading.
                        </p>
                        <p className="leading-relaxed">
                            Where traditional e-readers (Kindle, Apple Books) remediate the physical book—preserving its static layout, 
                            pagination, and linear passivity—Arphen proposes a model of <strong>"high-velocity data ingestion"</strong> mediated by 
                            local-first Artificial Intelligence.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-lg font-bold text-white uppercase tracking-wider opacity-80">1.1 Metabolism over Consumption</h3>
                        <p className="leading-relaxed">
                            The central thesis is that the biological eye, with its reliance on saccadic movement, constitutes a "cognitive bottleneck." 
                            By coupling <strong>Rapid Serial Visual Presentation (RSVP)</strong> with <strong>Entropy Modulation</strong>—a variable pacing 
                            mechanism controlled by the perplexity calculations of a Local LLM—the system transfers the labor of pacing from the subject 
                            to the machine.
                        </p>
                        <blockquote className="border-l-2 border-lacan-red pl-4 italic text-gray-400 py-2">
                            "It does not ask the user to read; it reads for the user, projecting the semantic content directly onto the retina."
                        </blockquote>
                    </section>
                </div>
            )}

            {activeSection === 'psychoanalysis' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-dune-gold uppercase tracking-wider">2. The Psychoanalysis of Interface</h2>
                        <p className="leading-relaxed text-lg">
                            The "Scansion Engine" treats the text as the discourse of the Other. It applies the Lacanian concept 
                            of the <strong>variable-length session</strong> to reading.
                        </p>
                    </section>
                    
                    <section className="space-y-4">
                        <h3 className="text-lg font-bold text-white uppercase tracking-wider opacity-80">2.1 The Violence of the Cut</h3>
                        <p className="leading-relaxed">
                            In Arphen, the <em>meaning</em> controls the pace.
                        </p>
                        <ul className="list-none space-y-4 pl-4 border-l border-white/10">
                            <li>
                                <strong className="text-white block mb-1">The Acceleration (Empty Speech)</strong>
                                When the text is predictable or cliché (low information entropy), the engine accelerates. 
                                It treats this as "empty speech" that does not require deep cognitive processing.
                            </li>
                            <li>
                                <strong className="text-white block mb-1">The Brake (The Cut)</strong>
                                When the text achieves "high philosophical density" or high perplexity, the engine "slams the brakes." 
                                This sudden deceleration is the digital equivalent of the Lacanian cut. It forces the reader to halt, 
                                to "tarry with the unconscious" of the text.
                            </li>
                        </ul>
                    </section>

                     <section className="space-y-4">
                        <h3 className="text-lg font-bold text-white uppercase tracking-wider opacity-80">2.2 The Exigent Sadist</h3>
                        <p className="leading-relaxed">
                            The interface positions the software as an "exigent sadist"—one who carries a poetic knife. 
                            It subjects the reader to a relentless stream of data, creating a dynamic of <em>jouissance</em> (painful pleasure). 
                            The reader is not a consumer, but a "pilot" navigating a high-speed information stream.
                        </p>
                    </section>
                </div>
            )}

            {activeSection === 'architecture' && (
                 <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-dune-gold uppercase tracking-wider">3. The Exegete: Local-First AI</h2>
                        <p className="leading-relaxed text-lg">
                            The "Backend-of-the-Mind," referred to as <strong>The Exegete</strong>, is the computational engine responsible 
                            for metabolizing text. It relies on <strong>WebGPU</strong> and <strong>WebLLM</strong> to run large language models 
                            entirely within the browser.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-lg font-bold text-white uppercase tracking-wider opacity-80">3.1 The Pulse (Entropy Calculation)</h3>
                        <p className="leading-relaxed">
                            For every word $w$, the system calculates Surprisal $S(w)$:
                        </p>
                        <div className="bg-black/40 p-4 rounded border border-white/10 font-mono text-center text-magma-vent">
                            S(w) = -log₂ P(w | context)
                        </div>
                        <p className="leading-relaxed">
                            High surprisal means low probability. The Exegete assigns pacing based on this metric, externalizing 
                            the brain's natural processing latency.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-lg font-bold text-white uppercase tracking-wider opacity-80">3.2 The Maw (Ingestion Pipeline)</h3>
                        <p className="leading-relaxed">
                            The ingestion process converts raw EPUB/PDFs into actionable data. It aggressively strips the "corpse of the typesetter's work" 
                            (formatting, CSS) to reduce the text to a pure stream of tokens.
                        </p>
                    </section>
                </div>
            )}

            {activeSection === 'network' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-dune-gold uppercase tracking-wider">4. The Synapse: Peer-to-Peer</h2>
                        <p className="leading-relaxed text-lg">
                            To maintain "Digital Sovereignty" and avoid cloud dependency, Arphen employs a serverless sync architecture.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-lg font-bold text-white uppercase tracking-wider opacity-80">4.1 WebRTC via QR Codes</h3>
                        <p className="leading-relaxed">
                            Syncing data between Desktop (The Ingestion Engine) and Mobile (The Viewing Portal) uses local-first 
                            <strong>WebRTC</strong> channels. The handshake logic (Exchange of SDP) is performed optically via QR codes, 
                            eliminating the need for a central signaling server.
                        </p>
                         <ul className="text-sm list-disc pl-5 space-y-2 text-gray-400">
                            <li>Ingest on Mac (High Compute).</li>
                            <li>Generate QR containing WebRTC Offer.</li>
                            <li>Scan with Phone.</li>
                            <li>Direct P2P tunnel established over LAN.</li>
                        </ul>
                    </section>
                </div>
            )}

            {activeSection === 'ethics' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <section className="space-y-4">
                        <h2 className="text-xl font-bold text-dune-gold uppercase tracking-wider">5. The Librarian</h2>
                        <p className="leading-relaxed text-lg">
                            The "Librarian" component navigates the tension between open-source idealism and economic necessity.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-lg font-bold text-white uppercase tracking-wider opacity-80">5.1 The Prescription Engine</h3>
                        <p className="leading-relaxed">
                            The Librarian acts as a local AI agent guiding discovery. It prioritizes the Public Domain via the 
                            <strong>Gutendex API</strong> (Project Gutenberg wrapper).
                        </p>
                    </section>

                     <section className="space-y-4">
                        <h3 className="text-lg font-bold text-white uppercase tracking-wider opacity-80">5.2 SponsorLink Logic</h3>
                        <p className="leading-relaxed">
                             If the AI recommends a free classic (e.g., <em>Moby Dick</em>), it may also identify a modern, copyrighted "counterpart" 
                             (e.g., <em>The Whale</em>) to generate affiliate revenue via client-side link generation, operating in a complex regulatory grey area.
                        </p>
                    </section>
                </div>
            )}

            <div className="pt-12 border-t border-white/10 mt-12">
                <p className="text-xs text-center text-gray-600 uppercase tracking-widest">
                    Arphen Research Division // 2026
                </p>
            </div>
        </div>
      </div>
    </div>
  );
};

