import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// `import.meta.env.BASE_URL` mirrors Vite's `base` config (e.g. "/" locally,
// "/Project_1/" on GitHub Pages). Strip the trailing slash for react-router.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
