import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import EscoSuggestInput from './EscoSuggestInput.jsx';
import { Button } from './ui/button.jsx';
import { useModalA11y } from '../lib/useModalA11y.js';
import { useT } from '../i18n/index.jsx';

const EXAMPLE_LIMIT = 80;

// Edits an array of { skill, example_project } pairs. Used for "what you can
// teach" where the spec calls for an optional example project per skill.
// ESCO autocomplete is suggestive: confirm a custom string with Enter to skip.
// Visual language: hairline row list; clicking a row opens a popup where the
// example project can be edited and the skill removed.
export default function TeachSkillsEditor({ value = [], onChange, placeholder, lang, ariaLabel }) {
  const { t } = useT();
  const [skillInput, setSkillInput] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);
  const [draft, setDraft] = useState('');
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
  const dialogRef = useModalA11y(editingIdx !== null);
  const effectivePlaceholder = placeholder || t('components.teachSkills.placeholder');

  async function addSkill(raw) {
    const skill = (raw || '').trim();
    if (!skill) return;
    const exists = value.some((v) => v.skill.toLowerCase() === skill.toLowerCase());
    if (!exists && await commit([...value, { skill, example_project: '' }])) setSkillInput('');
  }

  async function saveExample() {
    if (draft.length > EXAMPLE_LIMIT || busyRef.current) return;
    if (await commit(value.map((v, i) => i === editingIdx ? { ...v, example_project: draft } : v))) setEditingIdx(null);
  }

  async function removeSkill(idx) {
    if (!await commit(value.filter((_, i) => i !== idx))) return;
    setEditingIdx(null);
  }

  const editing = editingIdx !== null ? value[editingIdx] : null;

  // Close the popup on Escape.
  useEffect(() => {
    if (editingIdx === null) return undefined;
    function onKey(e) { if (e.key === 'Escape' && !busyRef.current) setEditingIdx(null); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingIdx]);

  return (
    <div>
      {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
      <fieldset disabled={busy} className="min-w-0">
      {value.length > 0 && (
        <div className="divide-y divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
          {value.map((entry, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setDraft(entry.example_project || ''); setEditingIdx(i); setError(''); }}
              aria-haspopup="dialog"
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left first:pt-0"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{entry.skill}</span>
                <span className="block truncate text-xs text-muted-foreground">{entry.example_project || t('components.teachSkills.giveExample')}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2.5">
                {entry.example_project && (
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                )}
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      )}

      <label htmlFor={inputId} className="mt-3 mb-2 block text-sm font-semibold">{ariaLabel || t('components.teachSkills.ariaAdd')}</label>
      <div className="flex items-start gap-2">
        <EscoSuggestInput
          value={skillInput}
          onChange={setSkillInput}
          inputRef={inputRef}
          inputId={inputId}
          onCommitEsco={(item) => addSkill(item.label)}
          onCommitCustom={(text) => addSkill(text)}
          placeholder={effectivePlaceholder}
          inputClassName="input w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
          lang={lang}
          ariaLabel={ariaLabel || t('components.teachSkills.ariaAdd')}
        />
        <Button type="button" variant="outline" disabled={!skillInput.trim() || busy} onMouseDown={e => e.preventDefault()} onClick={() => addSkill(skillInput)}>{t('components.skillTag.add')}</Button>
      </div>
      </fieldset>

      {/* Popup — edit the example project / remove the skill. */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setEditingIdx(null); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`teach-skill-title-${editingIdx}`}
            className="max-h-[85vh] overflow-y-auto w-full max-w-md rounded-2xl bg-white [box-shadow:var(--shadow-overlay)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-5">
              <h2 id={`teach-skill-title-${editingIdx}`} className="text-base font-medium leading-snug text-foreground">
                {editing.skill}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('components.session.close')}
                disabled={busy}
                onClick={() => setEditingIdx(null)}
              >
                <X />
              </Button>
            </div>

            <div className="space-y-1 p-5">
              <label className="label-meta" htmlFor={`teach-example-${editingIdx}`}>
                {t('components.teachSkills.exampleFor', { skill: editing.skill })}
              </label>
              <p className="text-xs text-muted-foreground">{t('components.teachSkills.exampleInstruction')}</p>
              {draft.length > EXAMPLE_LIMIT && <p role="alert" className="text-sm text-destructive">{t('components.teachSkills.legacyExample')}</p>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <input
                id={`teach-example-${editingIdx}`}
                autoFocus
                type="text"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                maxLength={Math.max(EXAMPLE_LIMIT, (editing.example_project || '').length)}
                disabled={busy}
                aria-invalid={draft.length > EXAMPLE_LIMIT}
                placeholder={t('components.teachSkills.examplePlaceholder')}
                className="input"
              />
              <p className="text-right text-[11px] text-muted-foreground tabular-nums">
                {draft.length}/{EXAMPLE_LIMIT}
              </p>
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] p-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => removeSkill(editingIdx)}
              >
                {t('components.teachSkills.remove', { skill: editing.skill })}
              </Button>
              <Button type="button" size="sm" className="ml-auto" disabled={busy} onClick={() => setEditingIdx(null)}>
                {t('profile.btn.cancel')}
              </Button>
              <Button type="button" size="sm" disabled={busy || draft.length > EXAMPLE_LIMIT} onClick={saveExample}>{busy ? t('profile.btn.saving') : t('profile.btn.save')}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
