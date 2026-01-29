import { useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Archive } from './components/Library/Archive'
import { Librarian } from './components/Library/Librarian'
import { ReaderPage } from './components/Reader/ReaderPage'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import { Manifesto } from './components/Manifesto'
import { Research } from './components/Research'
import { Manual } from './components/Manual'
import { ModelDownloadModal } from './components/ModelDownloadModal'
import { Onboarding } from './components/Onboarding/Onboarding'
import { SyncPage } from './components/Sync/SyncPage'
import { UpdatePrompt } from './components/UpdatePrompt'
import { useSettingsStore } from './core/store/settings'
import { clsx } from 'clsx'
import { GlobalNavSidebar, type ViewState } from './components/GlobalNavSidebar'

function App() {
  const { theme, hasCompletedOnboarding } = useSettingsStore()
  const navigate = useNavigate();
  const location = useLocation();

  // /sync page is completely standalone - no sidebar, no AI modal, no onboarding
  const isSyncPage = location.pathname === '/sync';

  // Determine current view for sidebar highlighting
  let view: ViewState = 'archive';
  if (location.pathname.startsWith('/reader')) view = 'reader';
  else if (location.pathname === '/library') view = 'library';
  else if (location.pathname === '/settings') view = 'settings';
  else if (location.pathname === '/manifesto') view = 'manifesto';
  else if (location.pathname === '/research') view = 'research';
  else if (location.pathname === '/manual') view = 'manual';

  // Apply theme to body
  useEffect(() => {
    document.body.className = ''; // Reset
    if (theme === 'dunes') document.body.classList.add('theme-dunes');
    if (theme === 'ash') document.body.classList.add('theme-ash');
    // volcanic is default (no class)
  }, [theme]);

  // Sync page bypasses onboarding and all app chrome
  if (isSyncPage) {
    return <SyncPage />;
  }

  if (!hasCompletedOnboarding) {
        return <Onboarding />;
  }

  return (
    <div className={clsx(
      "w-screen h-screen flex overflow-hidden transition-colors duration-700",
      "bg-basalt text-white"
    )}>
      <GlobalNavSidebar
        view={view}
        currentBook={null} // We rely on routing now
        onNavigate={(v) => {
          if (v === 'reader') {
             // If we are already in a reader route, do nothing or maybe handle "resume" logic later
             // For now, if we click "Reader" and we aren't there, we could go to archive or back?
             // Since we removed 'currentBook' state, we can't easily jump to "last book" without storage.
             // Simplest: Navigate to archive if not in reader.
             navigate('/'); 
          } else if (v === 'archive') {
             navigate('/');
          } else {
             navigate('/' + v);
          }
        }}
      />

      <div className="flex-1 min-w-0 min-h-0 overflow-auto flex justify-center relative">
        {/* Mica Dust Layer */}
        <div className="mica-dust-layer" />

        <ModelDownloadModal />

        <Routes>
          <Route path="/" element={<Archive onOpenBook={(book) => navigate(`/reader/${book.id}`)} />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/reader/:bookId" element={<ReaderPage />} />
          <Route path="/library" element={
            <div className="w-full h-full max-w-4xl p-4 flex flex-col">
              <Librarian />
            </div>
          } />
          <Route path="/settings" element={<Navigate to="/settings/pacing" replace />} />
          <Route path="/settings/:tab" element={<SettingsPanel onClose={() => navigate(-1)} />} />
          <Route path="/manual" element={<Manual />} />
          <Route path="/manifesto" element={<Manifesto onBack={() => navigate('/')} />} />
          <Route path="/research" element={<Research />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>

      {/* Made by Arphen Corner Label - Only show if not in Manifesto */}
      {view !== 'manifesto' && (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            onClick={() => navigate('/manifesto')}
            className="text-[10px] font-mono text-white/30 hover:text-lacan-red transition-colors tracking-widest uppercase"
          >
            Made by <span className="text-neon-pride font-bold">Arphen</span>
          </button>
        </div>
      )}

      {/* PWA Update Prompt */}
      <UpdatePrompt />
    </div>
  )
}

export default App
