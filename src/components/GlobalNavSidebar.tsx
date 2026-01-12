import { clsx } from 'clsx';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandName } from './BrandName';
import { AIStatusPanel } from './AIStatusPanel';
import type { BookDocType } from '../core/sync/db';

export type ViewState = 'archive' | 'reader' | 'library' | 'settings' | 'manifesto' | 'research' | 'manual';

interface GlobalNavSidebarProps {
  view: ViewState;
  currentBook: BookDocType | null;
  onNavigate: (view: ViewState) => void;
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

const SettingsSubItem = ({ label, path }: { label: string; path: string }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = location.pathname === path;

  return (
    <button
      onClick={() => navigate(path)}
      className={clsx(
        "w-[calc(100%-1rem)] text-left font-mono text-[10px] tracking-wider uppercase px-3 py-1.5 ml-4 border-l transition-colors",
        isActive
          ? "border-dune-gold text-dune-gold bg-dune-gold/5"
          : "border-white/10 text-white/40 hover:text-white hover:border-white/30"
      )}
    >
      {label}
    </button>
  );
};

export function GlobalNavSidebar({ view, currentBook, onNavigate }: GlobalNavSidebarProps) {
  return (
    <div className="h-full w-64 shrink-0 border-r border-white/10 bg-black/20 backdrop-blur-sm flex flex-col">
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between gap-2">
          <BrandName className="text-lg" />
        </div>
        {/* AI Status Panel - Always visible */}
        <div className="mt-3">
          <AIStatusPanel variant="sidebar" />
        </div>
      </div>

      <div className="flex-1 p-4 flex flex-col gap-2">
        <NavItem
          label={currentBook ? 'Reader' : 'Reader'} 
          target="reader"
          active={view === 'reader'}
          disabled={!currentBook && view !== 'reader'} 
          onClick={() => onNavigate('reader')}
        />
        <NavItem label="Archive" target="archive" active={view === 'archive'} onClick={() => onNavigate('archive')} />
        <NavItem label="Library" target="library" active={view === 'library'} onClick={() => onNavigate('library')} />
        <NavItem label="Research" target="research" active={view === 'research'} onClick={() => onNavigate('research')} />
        <NavItem label="Manual" target="manual" active={view === 'manual'} onClick={() => onNavigate('manual')} />
        <NavItem label="Settings" target="settings" active={view === 'settings'} onClick={() => onNavigate('settings')} />
        
        {view === 'settings' && (
          <div className="flex flex-col gap-1 mb-2 animate-in slide-in-from-left-2 duration-200">
              <SettingsSubItem label="Pacing Engine" path="/settings/pacing" />
              <SettingsSubItem label="Summarizer" path="/settings/summarizer" />
              <SettingsSubItem label="Librarian" path="/settings/librarian" />
          </div>
        )}
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
