import React, { useRef, useState } from 'react';
import EscoSuggestInput from './EscoSuggestInput.jsx';
import { useT } from '../i18n/index.jsx';

// Edits an array of { skill, example_project } pairs. Used for "what you can
// teach" where the spec calls for an optional example project per skill.
// ESCO autocomplete is suggestive: confirm a custom string with Enter to skip.
export default function TeachSkillsEditor({ value = [], onChange, placeholder, lang, ariaLabel }) {
  const { t } = useT();
  const [skillInput, setSkillInput] = useState('');
  const inputRef = useRef(null);
  const effectivePlaceholder = placeholder || t('components.teachSkills.placeholder');

  function addSkill(raw) {
    const skill = (raw || '').trim();
    if (!skill) return;
    const exists = value.some((v) => v.skill.toLowerCase() === skill.toLowerCase());
    if (!exists) onChange([...value, { skill, example_project: '' }]);
  }

  function updateExample(idx, example) {
    onChange(value.map((v, i) => i === idx ? { ...v, example_project: example } : v));
  }

  function removeSkill(idx) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-3">
      <div className="border border-gray-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-transparent bg-white min-h-[44px] flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          aria-label={ariaLabel || t('components.teachSkills.ariaAdd')}
          title={t('components.teachSkills.ariaAdd')}
          className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary hover:bg-primary/20 text-base leading-none flex-shrink-0"
        >
          +
        </button>
        <EscoSuggestInput
          value={skillInput}
          onChange={setSkillInput}
          inputRef={inputRef}
          onCommitEsco={(item) => addSkill(item.label)}
          onCommitCustom={(text) => addSkill(text)}
          onBackspaceEmpty={() => value.length > 0 && onChange(value.slice(0, -1))}
          placeholder={value.length === 0 ? effectivePlaceholder : t('components.teachSkills.addAnother')}
          inputClassName="w-full outline-none text-sm py-0.5 bg-transparent"
          lang={lang}
          ariaLabel={ariaLabel || t('components.teachSkills.ariaAdd')}
        />
      </div>

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((entry, i) => (
            <div key={i} className="bg-gray-50 rounded-lg px-3 py-2.5 flex items-start gap-3">
              <span className="bg-blue-50 text-primary border border-blue-200 rounded-full px-3 py-0.5 text-sm font-medium mt-1 break-words max-w-[16rem]">
                {entry.skill}
              </span>
              <input
                type="text"
                value={entry.example_project}
                onChange={e => updateExample(i, e.target.value)}
                placeholder={t('components.teachSkills.examplePlaceholder')}
                className="flex-1 min-w-0 outline-none text-sm bg-transparent border-b border-transparent focus:border-primary py-1"
              />
              <button
                type="button"
                onClick={() => removeSkill(i)}
                className="text-gray-400 hover:text-red-500 text-sm flex-shrink-0 mt-1"
                aria-label={t('components.teachSkills.remove', { skill: entry.skill })}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
