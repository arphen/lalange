import { useState, useEffect } from 'react'
import { Archive } from './components/Library/Archive'
import { Librarian } from './components/Library/Librarian'
import { Reader } from './components/Reader/Reader'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import { Manifesto } from './components/Manifesto'
import { ModelDownloadModal } from './components/ModelDownloadModal'
import { Onboarding } from './components/Onboarding/Onboarding'
import { BrandName } from './components/BrandName'
import type { BookDocType } from './core/sync/db'
import { useSettingsStore } from './core/store/settings'
import { useAIStore } from './core/store/ai'
import { clsx } from 'clsx'

type ViewState = 'archive' | 'reader' | 'library' | 'settings' | 'manifesto';

interface NavButtonProps {
  target: ViewState;
  label: string;
  currentView: ViewState;
  onNavigate: (view: ViewState) => void;
}

const NavButton = ({ target, label, currentView, onNavigate }: NavButtonProps) => (
  <button
    onClick={() => onNavigate(target)}
    className={clsx(
      "text-xs transition-colors font-mono px-2",
      currentView === target ? "text-dune-gold font-bold" : "text-gray-600 hover:text-dune-gold"
    )}
  >
    [ {label} ]
  </button>
);

function App() {
  const [currentBook, setCurrentBook] = useState<BookDocType | null>(null)
  const [view, setView] = useState<ViewState>('archive')
  const { theme, hasCompletedOnboarding } = useSettingsStore()
  const aiState = useAIStore()

  const handleOpenBook = (book: BookDocType | null) => {
    setCurrentBook(book);
    if (book) {
      setView('reader');
    }
  };

  // Apply theme to body
  useEffect(() => {
    document.body.className = ''; // Reset
    if (theme === 'dunes') document.body.classList.add('theme-dunes');
    if (theme === 'ash') document.body.classList.add('theme-ash');
    // volcanic is default (no class)
  }, [theme]);

  const handleCloseSettings = () => {
    if (currentBook) {
      setView('reader');
    } else {
      setView('archive');
    }
  };

  if (!hasCompletedOnboarding) {
        return <Onboarding />;
  }

  return (
    <div className={clsx(
      "w-screen h-screen flex flex-col items-center overflow-hidden transition-colors duration-700",
      // Base colors are handled by body/CSS variables, but we can enforce defaults here if needed
      "bg-basalt text-white"
    )}>
      <div className="w-full flex justify-between items-center p-4 border-b border-white/10 bg-black/20 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4">
          <BrandName className="text-xl animate-pulse" />
          {aiState.activity && (
            <div className="hidden md:flex items-center gap-2 text-[10px] text-dune-gold font-mono border border-dune-gold/20 px-2 py-1 rounded bg-dune-gold/5 animate-in fade-in slide-in-from-left-2">
              <span className="animate-pulse">●</span>
              <span className="uppercase tracking-wider">{aiState.activity}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {currentBook && <NavButton target="reader" label="READER" currentView={view} onNavigate={setView} />}
          <NavButton target="archive" label="ARCHIVE" currentView={view} onNavigate={setView} />
          <NavButton target="library" label="LIBRARY" currentView={view} onNavigate={setView} />
          <NavButton target="settings" label="SETTINGS" currentView={view} onNavigate={setView} />
        </div>
      </div>

      <div className="flex-1 w-full overflow-auto flex justify-center relative">
        {/* Mica Dust Layer */}
        <div className="mica-dust-layer" />

        <ModelDownloadModal />

        {view === 'settings' ? (
          <SettingsPanel onClose={handleCloseSettings} />
        ) : view === 'manifesto' ? (
          <Manifesto onBack={() => setView('archive')} />
        ) : view === 'reader' && currentBook ? (
          <Reader
            book={currentBook}
            onOpenSettings={() => setView('settings')}
          />
        ) : view === 'library' ? (
          <div className="w-full h-full max-w-4xl p-4 flex flex-col">
            <Librarian />
          </div>
        ) : (
          <Archive onOpenBook={handleOpenBook} />
        )}
      </div>

      {/* Made by Arphen Corner Label */}
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setView('manifesto')}
          className="text-[10px] font-mono text-white/30 hover:text-lacan-red transition-colors tracking-widest uppercase"
        >
          Made by <span className="text-neon-pride font-bold">Arphen</span>
        </button>
      </div>
    </div>
  )
}

export default App
