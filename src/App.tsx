import { useState, useEffect } from 'react'
import { Archive } from './components/Library/Archive'
import { Librarian } from './components/Library/Librarian'
import { Reader } from './components/Reader/Reader'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import { Manifesto } from './components/Manifesto'
import { ModelDownloadModal } from './components/ModelDownloadModal'
import { Onboarding } from './components/Onboarding/Onboarding'
import type { BookDocType } from './core/sync/db'
import { useSettingsStore } from './core/store/settings'
import { clsx } from 'clsx'
import { GlobalNavSidebar, type ViewState } from './components/GlobalNavSidebar'

function App() {
  const [currentBook, setCurrentBook] = useState<BookDocType | null>(null)
  const [view, setView] = useState<ViewState>('archive')
  const { theme, hasCompletedOnboarding } = useSettingsStore()

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
      "w-screen h-screen flex overflow-hidden transition-colors duration-700",
      // Base colors are handled by body/CSS variables, but we can enforce defaults here if needed
      "bg-basalt text-white"
    )}>
      <GlobalNavSidebar
        view={view}
        currentBook={currentBook}
        onNavigate={setView}
      />

      <div className="flex-1 min-w-0 min-h-0 overflow-auto flex justify-center relative">
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
