import React, { useEffect, useMemo, useRef, useState } from 'react';
import { searchEscoSkills, browserLanguage } from '../lib/esco.js';
import { useT } from '../i18n/index.jsx';

// EscoSuggestInput wraps a single-line text input with an ESCO-backed
// suggestions dropdown. Behaviour matches the plan:
//   * debounce 250 ms, min 2 chars, abort previous fetch
//   * Arrow Up / Down / Enter / Escape keyboard navigation
//   * Suggestive only — pressing Enter without a highlighted suggestion
//     still confirms the user's raw text (`onCommitCustom`).
//
// Props:
//   value, onChange    Controlled input string.
//   onCommitEsco(item) Called when user picks an ESCO suggestion.
//                       item = { label, uri, language }.
//   onCommitCustom(text) Called when user confirms free text (Enter/comma/blur).
//   onBackspaceEmpty() Called when Backspace pressed with empty input.
//   placeholder        Input placeholder.
//   inputClassName     Class for the underlying <input>.
//   lang               Language override (defaults to browser locale).
//   inputRef           Optional ref forwarded to the input element.
//   inputId            Optional id forwarded to the input element.

const DEBOUNCE_MS = 250;

export default function EscoSuggestInput({
  value,
  onChange,
  onCommitEsco,
  onCommitCustom,
  onBackspaceEmpty,
  placeholder,
  inputClassName,
  lang,
  inputRef,
  inputId,
  ariaLabel,
}) {
  const { t } = useT();
  const effectiveLang = useMemo(() => lang || browserLanguage(), [lang]);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef(null);
  const abortRef = useRef(null);
  const blurTimerRef = useRef(null);
  // Refs mirror the latest values so the blur timeout never closes over stale
  // state (a fresh keystroke would otherwise commit the previous text).
  const valueRef = useRef(value);
  const suggestionsRef = useRef(suggestions);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { suggestionsRef.current = suggestions; }, [suggestions]);
  const listboxId = useMemo(
    () => `esco-listbox-${Math.random().toString(36).slice(2, 9)}`,
    []
  );

  // Debounced ESCO query. Aborts prior in-flight request on each keystroke.
  useEffect(() => {
    if (!value || value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      setHighlight(-1);
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const results = await searchEscoSkills(value, {
          lang: effectiveLang,
          limit: 6,
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted) return;
        setSuggestions(results);
        setOpen(results.length > 0);
        // Do NOT auto-highlight the first item. The user must explicitly
        // ArrowDown into the list to choose a suggestion. Otherwise Enter
        // commits whatever they typed, so we never silently substitute a
        // fuzzy ESCO match for the user's literal text.
        setHighlight(-1);
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setOpen(false);
          setHighlight(-1);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, effectiveLang]);

  // Abort any in-flight ESCO fetch + cancel pending blur commits on unmount.
  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  // Clicking outside closes the dropdown
  useEffect(() => {
    function onDocClick(e) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function selectEsco(item) {
    if (!item) return;
    onCommitEsco?.(item);
    onChange('');
    setOpen(false);
    setSuggestions([]);
    setHighlight(-1);
  }

  function commitCustom() {
    // Read fresh values from refs so a queued blur timeout never commits a
    // stale value that the user has already cleared/changed.
    const raw = (valueRef.current || '').trim();
    if (!raw) return;
    const currentSuggestions = suggestionsRef.current;
    const exact = currentSuggestions.find((s) => s.label.toLowerCase() === raw.toLowerCase());
    if (exact) selectEsco(exact);
    else {
      onCommitCustom?.(raw);
      onChange('');
      setOpen(false);
      setSuggestions([]);
      setHighlight(-1);
    }
  }

  function handleKeyDown(e) {
    if (open && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (highlight >= 0 && highlight < suggestions.length) {
          selectEsco(suggestions[highlight]);
        } else {
          commitCustom();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setHighlight(-1);
        return;
      }
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitCustom();
      return;
    }
    if (e.key === 'Backspace' && !value) {
      onBackspaceEmpty?.();
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1 min-w-[140px]">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => {
          // Any new keystroke invalidates a queued blur commit.
          if (blurTimerRef.current) {
            clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
          }
          onChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Defer so a click on a listbox option (mousedown) wins.
          if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
          blurTimerRef.current = setTimeout(() => {
            blurTimerRef.current = null;
            if ((valueRef.current || '').trim()) commitCustom();
            setOpen(false);
          }, 120);
        }}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck="false"
        role="combobox"
        aria-label={ariaLabel || placeholder || 'Skill'}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-busy={loading}
        aria-activedescendant={
          highlight >= 0 && suggestions[highlight]
            ? `${listboxId}-opt-${highlight}`
            : undefined
        }
        className={inputClassName}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg text-sm"
        >
          {suggestions.map((item, idx) => {
            const active = idx === highlight;
            return (
              <li
                key={item.uri || `${item.label}-${idx}`}
                id={`${listboxId}-opt-${idx}`}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => { e.preventDefault(); selectEsco(item); }}
                onMouseEnter={() => setHighlight(idx)}
                className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer ${active ? 'bg-blue-50 text-primary' : 'text-foreground hover:bg-gray-50'}`}
              >
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">
                  ESCO{item.language && item.language !== 'en' ? ` · ${item.language}` : ''}
                </span>
              </li>
            );
          })}
          {loading && (
            <li className="px-3 py-1.5 text-[11px] text-gray-400 italic">{t('components.esco.searching')}</li>
          )}
        </ul>
      )}
    </div>
  );
}
