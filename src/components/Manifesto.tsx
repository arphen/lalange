import React from 'react';
import { BrandName } from './BrandName';

export const Manifesto: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    return (
        <div className="w-full h-full overflow-y-auto p-8 max-w-3xl mx-auto font-mono">
            <button
                onClick={onBack}
                className="mb-8 text-sm text-white/60 hover:text-white hover:underline"
            >
                ← Back
            </button>

            <h1 className="text-4xl font-bold mb-8 text-lacan-red">MANIFESTO</h1>

            <div className="space-y-6 text-lg leading-relaxed text-white/90">
                <p>
                    <BrandName /> represents a shift towards <strong>local-only usage of LLMs</strong> as a means to wrest control from Big AI.
                </p>

                <p>
                    We utilize already available models to perform LLM-agent interactions locally on the user side,
                    <strong>without any interaction with any other server</strong>.
                </p>

                <ul className="list-disc pl-6 space-y-2 text-white/80">
                    <li>No logins.</li>
                    <li>No tracking.</li>
                    <li>Just free, open source software.</li>
                </ul>

                <p>
                    Even the code on the user side could theoretically be made to be analyzed with an LLM to assert
                    no malicious code was injected.
                </p>

                <p className="text-xl font-bold pt-4 border-t border-white/20 mt-8">
                    This is the next generation of open software.
                </p>
            </div>
        </div>
    );
};
