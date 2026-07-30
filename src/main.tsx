import './core/runtimeCompatibility'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ExhibitionRender } from './components/ExhibitionRender.tsx'
import { pwaUpdateController } from './core/pwa/browserUpdateController'

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => {
      // ignore
    });
}

if (import.meta.env.PROD) {
  void pwaUpdateController.start()
}

const root = createRoot(document.getElementById('root')!)

// Automated exhibition render mode (see docs/exhibition.md). Mounted without
// StrictMode/Router/app-chrome so canvas recording is deterministic. The heavy
// app graph is only imported when NOT rendering the exhibition.
const isExhibition = new URLSearchParams(window.location.search).get('exhibition') === 'true'

if (isExhibition) {
  root.render(<ExhibitionRender />)
} else {
  Promise.all([
    import('react-router-dom'),
    import('./App.tsx'),
    import('./components/ErrorBoundary.tsx'),
  ]).then(([{ BrowserRouter }, { default: App }, { ErrorBoundary }]) => {
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ErrorBoundary>
      </StrictMode>,
    )
  })
}
