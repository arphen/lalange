import { clsx } from 'clsx';
import { BrandName } from './BrandName';
import type { BookDocType } from '../core/sync/db';

export type ViewState = 'archive' | 'reader' | 'library' | 'settings' | 'manifesto';

interface GlobalNavSidebarProps {
  view: ViewState;
  currentBook: BookDocType | null;
  onNavigate: (view: ViewState) => void;
  aiActivity?: string | null;
}

interface NavItemProps {
  label: string;
  target: ViewState;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const NavItem = ({ label, active, onClick, disabled }: NavItemProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'w-full text-left font-mono text-xs tracking-widest uppercase px-3 py-2 rounded border transition-colors',
      disabled
        ? 'opacity-40 cursor-not-allowed border-white/5 text-white/30'
        : active
          ? 'border-dune-gold/30 bg-dune-gold/10 text-dune-gold'
          : 'border-white/5 text-white/60 hover:text-dune-gold hover:border-white/20 hover:bg-white/5'
    )}
  >
    {label}
  </button>
);

export function GlobalNavSidebar({ view, currentBook, onNavigate, aiActivity }: GlobalNavSidebarProps) {
  return (
    <div className="h-full w-64 shrink-0 border-r border-white/10 bg-black/20 backdrop-blur-sm flex flex-col">
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between gap-2">
          <BrandName className="text-lg" />
        </div>
        {aiActivity && (
          <div className="mt-3 flex items-center gap-2 text-[10px] text-dune-gold font-mono border border-dune-gold/20 px-2 py-1 rounded bg-dune-gold/5">
            <span className="animate-pulse">●</span>
            <span className="uppercase tracking-wider truncate">{aiActivity}</span>
          </div>
        )}
      </div>

      <div className="flex-1 p-4 flex flex-col gap-2">
        <NavItem
          label={currentBook ? 'Reader' : 'Reader (no book)'}
          target="reader"
          active={view === 'reader'}
          disabled={!currentBook}
          onClick={() => currentBook && onNavigate('reader')}
        />
        <NavItem label="Archive" target="archive" active={view === 'archive'} onClick={() => onNavigate('archive')} />
        <NavItem label="Library" target="library" active={view === 'library'} onClick={() => onNavigate('library')} />
        <NavItem label="Settings" target="settings" active={view === 'settings'} onClick={() => onNavigate('settings')} />
      </div>

      <div className="p-4 border-t border-white/10">
        <button
          onClick={() => onNavigate('manifesto')}
          className={clsx(
            'w-full font-mono text-[10px] tracking-widest uppercase px-3 py-2 rounded border border-white/5 text-white/40 hover:text-lacan-red hover:border-white/20 hover:bg-white/5 transition-colors',
            view === 'manifesto' && 'text-lacan-red border-lacan-red/30 bg-lacan-red/10'
          )}
        >
          Manifesto
        </button>
      </div>
    </div>
  );
}
