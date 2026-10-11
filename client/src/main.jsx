import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import AppErrorBoundary from './components/AppErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { LanguageProvider } from './i18n/index.jsx';
import './index.css';

const CHUNK_RELOAD_KEY = 'ment:chunk-reload';

// Scrolling the page over a focused number field must not change its value.
document.addEventListener('wheel', () => { if (document.activeElement?.type === 'number') document.activeElement.blur(); }, { passive: true });

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    return;
  }
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  window.location.reload();
});

window.addEventListener('pageshow', () => {
  window.setTimeout(() => sessionStorage.removeItem(CHUNK_RELOAD_KEY), 60_000);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LanguageProvider>
        <AuthProvider>
          <AppErrorBoundary><App /></AppErrorBoundary>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
);
