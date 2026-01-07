import React from 'react';
import { clsx } from 'clsx';

export const BrandName: React.FC<{ className?: string }> = ({ className }) => (
    <span className={clsx("font-mono tracking-widest text-neon-pride", className)}>
        <span className="font-bold">X</span>YZ
    </span>
);
