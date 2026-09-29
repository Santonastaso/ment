import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

// Lightweight in-repo i18n.
//
// Catalogs are split into per-namespace JSON files under locales/en and
// locales/it/fr (e.g. nav.json, dashboard.json). They are auto-merged via Vite's
// import.meta.glob so adding a new namespace file requires no change here.
// Each file holds FLAT dotted keys (e.g. {"nav.home": "Home"}); namespaces
// keep prefixes distinct so Object.assign merge never collides.

const enModules = import.meta.glob('./locales/en/*.json', { eager: true });

function mergeCatalog(modules) {
  const out = {};
  for (const path in modules) {
    const mod = modules[path];
    Object.assign(out, mod.default || mod);
  }
  return out;
}

const CATALOG = { en: mergeCatalog(enModules) };
const loaders = {
  it: () => import('./locales/it.js'),
  fr: () => import('./locales/fr.js'),
};
const pendingCatalogs = new Map();

function loadCatalog(lang) {
  if (CATALOG[lang]) return Promise.resolve();
  if (!pendingCatalogs.has(lang)) {
    pendingCatalogs.set(lang, loaders[lang]().then((module) => {
      CATALOG[lang] = module.default;
    }).catch((error) => {
      pendingCatalogs.delete(lang);
      throw error;
    }));
  }
  return pendingCatalogs.get(lang);
}

const SUPPORTED = ['en', 'it', 'fr'];
const STORAGE_KEY = 'ment.lang';

export function getLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch { /* ignore */ }
  if (typeof navigator !== 'undefined') {
    const base = (navigator.language || 'en').toLowerCase().split('-')[0];
    if (SUPPORTED.includes(base)) return base;
  }
  return 'en';
}

function detectInitial() {
  return getLang();
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Standalone translator for non-React modules (e.g. the api shim) that can't
// use the useT() hook. Resolves the active language from storage by default.
export function translate(key, vars, lang) {
  const l = lang || getLang();
  const dict = CATALOG[l] || CATALOG.en;
  const raw = dict[key] || CATALOG.en[key] || key;
  return interpolate(raw, vars);
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(detectInitial);
  const [ready, setReady] = useState(() => Boolean(CATALOG[getLang()]));

  useEffect(() => {
    if (CATALOG[lang]) { setReady(true); return; }
    let active = true;
    loadCatalog(lang).catch(() => { if (active) setLangState('en'); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [lang]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    if (SUPPORTED.includes(next)) loadCatalog(next).then(() => setLangState(next)).catch(() => {});
  }, []);

  const t = useCallback((key, vars) => {
    const dict = CATALOG[lang] || CATALOG.en;
    const raw = dict[key] || CATALOG.en[key] || key;
    return interpolate(raw, vars);
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t, supported: SUPPORTED }), [lang, setLang, t]);
  return ready ? <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider> : null;
}

export function useT() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // Safe fallback if a component renders outside the provider (e.g. tests):
    // return the key itself so the UI degrades to English-ish key text rather
    // than crashing.
    return { lang: 'en', setLang: () => {}, t: (k, v) => interpolate(String(k), v), supported: SUPPORTED };
  }
  return ctx;
}
