import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import EscoSuggestInput from './EscoSuggestInput.jsx';
import { Button } from './ui/button.jsx';
import { useModalA11y } from '../lib/useModalA11y.js';
import { useT } from '../i18n/index.jsx';

// Tagged-input for plain skill strings. Each entry is just a string in the
// `value` array. ESCO autocomplete is suggestive: the user can still confirm
// a custom skill by pressing Enter without picking a suggestion.
// Visual language: hairline row list; clicking a row opens a popup where the
// skill can be removed.
export default function SkillTagInput({ value = [], onChange, placeholder, lang, ariaLabel }) {
  const { t } = useT();
  const [input, setInput] = useState('');
  const [openIdx, setOpenIdx] = useState(null);
  const inputRef = useRef(null);
  const inputId = useId();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function commit(next) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try { await onChange(next); return true; }
    catch { setError(t('profile.toast.skillSaveError')); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  const dialogRef = useModalA11y(openIdx !== null);
  const effectivePlaceholder = placeholder || t('components.skillTag.placeholder');

  async function addSkill(raw) {
    const skill = (raw || '').trim();
    if (!skill) return;
    if (value.map((v) => v.toLowerCase()).includes(skill.toLowerCase())) return;
    if (await commit([...value, skill])) setInput('');
  }

  async function removeSkill(idx) {
    if (!await commit(value.filter((_, i) => i !== idx))) return;
    setOpenIdx(null);
  }

  // Close the popup on Escape.
  useEffect(() => {
    if (openIdx === null) return undefined;
    function onKey(e) { if (e.key === 'Escape') setOpenIdx(null); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openIdx]);

  return (
    <div>
      {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
      <fieldset disabled={busy} className="min-w-0">
      {value.length > 0 && (
        <div className="divide-y divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
          {value.map((skill, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setOpenIdx(i)}
              aria-haspopup="dialog"
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left first:pt-0"
            >
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{skill}</span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <label htmlFor={inputId} className="mt-3 mb-2 block text-sm font-semibold">{ariaLabel || t('components.skillTag.ariaAdd')}</label>
      <div className="flex items-start gap-2">
        <EscoSuggestInput
          value={input}
          onChange={setInput}
          inputRef={inputRef}
          inputId={inputId}
          onCommitEsco={(item) => addSkill(item.label)}
          onCommitCustom={(text) => addSkill(text)}
          placeholder={effectivePlaceholder}
          inputClassName="input w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
          lang={lang}
          ariaLabel={ariaLabel || t('components.skillTag.ariaAdd')}
        />
        <Button type="button" variant="outline" disabled={!input.trim() || busy} onMouseDown={e => e.preventDefault()} onClick={() => addSkill(input)}>{t('components.skillTag.add')}</Button>
      </div>
      </fieldset>

      {/* Popup — remove the skill. */}
      {openIdx !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpenIdx(null); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`skill-tag-title-${openIdx}`}
            className="w-full max-w-md rounded-2xl bg-white [box-shadow:var(--shadow-overlay)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-5">
              <h2 id={`skill-tag-title-${openIdx}`} className="text-base font-medium leading-snug text-foreground">
                {value[openIdx]}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('components.session.close')}
                onClick={() => setOpenIdx(null)}
              >
                <X />
              </Button>
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] p-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => removeSkill(openIdx)}
              >
                {t('components.skillTag.remove', { skill: value[openIdx] })}
              </Button>
              <Button type="button" size="sm" className="ml-auto" onClick={() => setOpenIdx(null)}>
                {t('components.popup.done')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
