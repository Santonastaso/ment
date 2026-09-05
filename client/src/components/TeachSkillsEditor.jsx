import React, { useEffect, useRef, useState } from 'react';
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
  const inputRef = useRef(null);
  const dialogRef = useModalA11y(editingIdx !== null);
  const effectivePlaceholder = placeholder || t('components.teachSkills.placeholder');

  function addSkill(raw) {
    const skill = (raw || '').trim();
    if (!skill) return;
    const exists = value.some((v) => v.skill.toLowerCase() === skill.toLowerCase());
    if (!exists) onChange([...value, { skill, example_project: '' }]);
  }

  function updateExample(idx, example) {
    onChange(value.map((v, i) => i === idx ? { ...v, example_project: example.slice(0, EXAMPLE_LIMIT) } : v));
  }

  function removeSkill(idx) {
    onChange(value.filter((_, i) => i !== idx));
    setEditingIdx(null);
  }

  const editing = editingIdx !== null ? value[editingIdx] : null;

  // Close the popup on Escape.
  useEffect(() => {
    if (editingIdx === null) return undefined;
    function onKey(e) { if (e.key === 'Escape') setEditingIdx(null); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingIdx]);

  return (
    <div>
      {value.length > 0 && (
        <div className="divide-y divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
          {value.map((entry, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setEditingIdx(i)}
              aria-haspopup="dialog"
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left first:pt-0"
            >
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{entry.skill}</span>
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

      <div className={value.length > 0 ? 'pt-1' : undefined}>
        <EscoSuggestInput
          value={skillInput}
          onChange={setSkillInput}
          inputRef={inputRef}
          onCommitEsco={(item) => addSkill(item.label)}
          onCommitCustom={(text) => addSkill(text)}
          onBackspaceEmpty={() => value.length > 0 && onChange(value.slice(0, -1))}
          placeholder={value.length === 0 ? effectivePlaceholder : t('components.teachSkills.addAnother')}
          inputClassName="w-full outline-none text-sm py-2 bg-transparent"
          lang={lang}
          ariaLabel={ariaLabel || t('components.teachSkills.ariaAdd')}
        />
      </div>

      {/* Popup — edit the example project / remove the skill. */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingIdx(null); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`teach-skill-title-${editingIdx}`}
            className="w-full max-w-md rounded-2xl bg-white [box-shadow:var(--shadow-overlay)]"
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
                onClick={() => setEditingIdx(null)}
              >
                <X />
              </Button>
            </div>

            <div className="space-y-1 p-5">
              <label className="label-meta" htmlFor={`teach-example-${editingIdx}`}>
                {t('components.teachSkills.exampleFor', { skill: editing.skill })}
              </label>
              <p className="text-xs text-muted-foreground">{t('components.teachSkills.exampleHelp')}</p>
              <input
                id={`teach-example-${editingIdx}`}
                autoFocus
                type="text"
                value={editing.example_project}
                onChange={e => updateExample(editingIdx, e.target.value)}
                maxLength={EXAMPLE_LIMIT}
                placeholder={t('components.teachSkills.examplePlaceholder')}
                className="input"
              />
              <p className="text-right text-[11px] text-muted-foreground tabular-nums">
                {(editing.example_project || '').length}/{EXAMPLE_LIMIT}
              </p>
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] p-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => removeSkill(editingIdx)}
              >
                {t('components.teachSkills.remove', { skill: editing.skill })}
              </Button>
              <Button type="button" size="sm" className="ml-auto" onClick={() => setEditingIdx(null)}>
                {t('components.popup.done')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
