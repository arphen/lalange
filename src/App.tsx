import { useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation, Navigate, Link } from 'react-router'
import { Archive } from './components/Library/Archive'
import { Librarian } from './components/Library/Librarian'
import { ReaderPage } from './components/Reader/ReaderPage'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import { Manifesto } from './components/Manifesto'
import { Research } from './components/Research'
import { Manual } from './components/Manual'
import { AISetupWizard } from './components/ModelDownloadModal'
import { AIStatusPanel } from './components/AIStatusPanel'
import { SyncPage } from './components/Sync/SyncPage'
import { ExchangePage } from './components/Exchange/ExchangePage'
import { PwaUpdateStatus } from './components/PwaUpdateStatus'
import { LocalAccessQr } from './components/LocalAccessQr'
import { useSettingsStore } from './core/store/settings'
import { useAIStore } from './core/store/ai'
import { clsx } from 'clsx'
import { GlobalNavSidebar, type ViewState } from './components/GlobalNavSidebar'
import { SeoHead } from './components/SeoHead'
import { isAdaptivePacingEnabled } from './core/ai/policy'

function NotFound() {
  return (
    <>
      <SeoHead title="Route Not Found" robots="noindex, nofollow" />
      <main className="flex h-full w-full items-center justify-center bg-basalt px-6 py-16 text-white">
        <div className="max-w-xl space-y-8 font-mono">
          <p className="text-xs uppercase tracking-[0.3em] text-lacan-red">404 / signal absent</p>
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">This route does not exist.</h1>
          <p className="max-w-lg leading-relaxed text-white/60">
            The requested address is not part of the public instrument. Return to the archive or inspect the operating notes.
          </p>
          <nav className="flex flex-wrap gap-4 text-xs uppercase tracking-widest">
            <Link to="/" className="border border-dune-gold/60 px-4 py-3 text-dune-gold transition-colors hover:bg-dune-gold hover:text-black">
              Open archive
            </Link>
            <Link to="/manual" className="border border-white/20 px-4 py-3 text-white/70 transition-colors hover:border-white hover:text-white">
              Read manual
            </Link>
            <Link to="/research" className="border border-white/20 px-4 py-3 text-white/70 transition-colors hover:border-white hover:text-white">
              View research
            </Link>
          </nav>
        </div>
      </main>
    </>
  );
}

function App() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const navSidebarCollapsed = useSettingsStore((state) => state.navSidebarCollapsed);
  const adaptivePacingEnabled = useSettingsStore((state) => isAdaptivePacingEnabled(state));
  const showReaderAIStatus = useAIStore((state) => (
    adaptivePacingEnabled
    && !state.isSetupOpen
    && (
      state.lifecycleState === 'downloading'
      || state.lifecycleState === 'loading'
      || state.lifecycleState === 'unloading'
      || Boolean(state.activity)
    )
  ));
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isDayTheme = theme === 'day' || theme === 'dunes';

  const handleThemeToggle = () => {
    setTheme(isDayTheme ? 'volcanic' : 'day');
  };

  // Incoming device routes are completely standalone: receiving a book must not
  // require AI setup or any other first-run flow.
  const isSyncPage = location.pathname === '/sync';
  const isExchangePage = location.pathname.toLowerCase().startsWith('/exchange');

  // Determine current view for sidebar highlighting
  let view: ViewState = 'archive';
  if (location.pathname.startsWith('/reader')) view = 'reader';
  else if (location.pathname === '/library') view = 'library';
  else if (location.pathname === '/settings' || location.pathname.startsWith('/settings/')) view = 'settings';
  else if (location.pathname === '/manifesto') view = 'manifesto';
  else if (location.pathname === '/research') view = 'research';
  else if (location.pathname === '/manual') view = 'manual';

  // Apply theme to body
  useEffect(() => {
    document.body.classList.remove('theme-day', 'theme-dunes', 'theme-ash');

    if (theme === 'day' || theme === 'dunes') {
      document.body.classList.add('theme-day');
    } else if (theme === 'ash') {
      document.body.classList.add('theme-ash');
    }
    // volcanic is default (no class)
  }, [theme]);

  // Sync page bypasses onboarding and all app chrome
  if (isSyncPage) {
    return (
      <>
        <SeoHead title="Device Sync" robots="noindex, nofollow" />
        <SyncPage />
      </>
    );
  }
  if (isExchangePage) {
    return (
      <>
        <SeoHead title="Device Exchange" robots="noindex, nofollow" />
        <ExchangePage />
      </>
    );
  }

  return (
    <div className={clsx(
      "w-full h-full min-h-0 flex overflow-hidden transition-colors duration-700",
      "bg-basalt text-white"
    )}>
      {view !== 'reader' && (
        <>
          {/* Mobile Back-drop background mask */}
          {isMobileNavOpen && (
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden"
              onClick={() => setIsMobileNavOpen(false)}
            />
          )}

          {/* Persistent on Desktop, Slide-out drawer on Mobile */}
          <div className={clsx(
            "fixed inset-y-0 left-0 z-50 transform md:relative md:translate-x-0 transition-transform duration-300 shrink-0",
            isMobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
            navSidebarCollapsed ? "hidden" : "flex"
          )}>
            <GlobalNavSidebar
              view={view}
              currentBook={null} // We rely on routing now
              onScanHandoff={() => {
                setIsMobileNavOpen(false);
                navigate('/exchange');
              }}
              onNavigate={(v) => {
                setIsMobileNavOpen(false);
                if (v === 'reader') {
                   // Navigate to archive if not in reader.
                   navigate('/'); 
                } else if (v === 'archive') {
                   navigate('/');
                } else {
                   navigate('/' + v);
                }
              }}
            />
          </div>

          {/* Floating Mobile Hamburger Menu Trigger */}
          <button
            onClick={() => setIsMobileNavOpen(true)}
            className="fixed top-4 left-4 z-30 p-3 bg-black/40 backdrop-blur-sm rounded-full border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-all shadow-lg active:scale-95 md:hidden"
            title="Open Menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </>
      )}

      <div className={clsx(
        "flex-1 min-w-0 min-h-0 flex justify-center relative",
        view === 'reader' ? "overflow-hidden" : "overflow-auto",
      )}>
        {/* Mica Dust Layer */}
        <div className="mica-dust-layer" />

        <AISetupWizard />

        <Routes>
          <Route path="/" element={
            <Archive
              onOpenBook={(book) => navigate(`/reader/${book.id}`)}
              onScanHandoff={() => navigate('/exchange')}
            />
          } />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/exchange" element={<ExchangePage />} />
          <Route path="/reader/:bookId" element={<ReaderPage />} />
          <Route path="/library" element={
            <>
              <SeoHead title="Librarian" robots="noindex, nofollow" />
              <div className="w-full h-full max-w-4xl pt-16 px-4 pb-4 md:p-4 flex flex-col">
                <Librarian />
              </div>
            </>
          } />
          <Route path="/settings" element={<Navigate to="/settings/pacing" replace />} />
          <Route path="/settings/:tab" element={<SettingsPanel onClose={() => navigate(-1)} />} />
          <Route path="/manual" element={
            <div className="w-full h-full pt-16 md:pt-0">
              <Manual />
            </div>
          } />
          <Route path="/manifesto" element={<Manifesto onBack={() => navigate('/')} />} />
          <Route path="/research" element={
            <div className="w-full h-full pt-16 md:pt-0">
              <Research />
            </div>
          } />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>

      {view === 'reader' && showReaderAIStatus && (
        <div className="fixed left-3 bottom-24 z-[80] w-[min(22rem,calc(100vw-1.5rem))] md:left-6 md:bottom-6">
          <AIStatusPanel variant="global" />
        </div>
      )}

      {view !== 'reader' && (
        <div className="fixed top-4 right-4 z-[70]">
          <button
            type="button"
            onClick={handleThemeToggle}
            className={clsx(
              'theme-toggle-btn',
              isDayTheme ? 'theme-toggle-btn--day' : 'theme-toggle-btn--night'
            )}
            title={isDayTheme ? 'Switch to dark theme' : 'Switch to day theme'}
            aria-label={isDayTheme ? 'Switch to dark theme' : 'Switch to day theme'}
          >
            <span className="theme-toggle-btn__dot" aria-hidden />
            <span className="theme-toggle-btn__kicker">Theme</span>
            <span className="theme-toggle-btn__value">{isDayTheme ? 'Day' : 'Dark'}</span>
          </button>
        </div>
      )}

      {/* Made by Arphen Corner Label - Only show if not in Manifesto */}
      {view !== 'manifesto' && view !== 'reader' && (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            onClick={() => navigate('/manifesto')}
            className="text-[10px] font-mono text-white/30 hover:text-lacan-red transition-colors tracking-widest uppercase"
          >
            Made by <span className="text-neon-pride font-bold">Arphen</span>
          </button>
        </div>
      )}

      {view !== 'reader' && <LocalAccessQr />}

      <PwaUpdateStatus />
    </div>
  )
}

export default App
