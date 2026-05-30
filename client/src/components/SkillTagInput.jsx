import React, { useState } from 'react';
import EscoSuggestInput from './EscoSuggestInput.jsx';
import { useT } from '../i18n/index.jsx';

// Tagged-input for plain skill strings. Each entry is just a string in the
// `value` array. ESCO autocomplete is suggestive: the user can still confirm
// a custom skill by pressing Enter without picking a suggestion.
export default function SkillTagInput({ value = [], onChange, placeholder, lang, ariaLabel }) {
  const { t } = useT();
  const [input, setInput] = useState('');
  const effectivePlaceholder = placeholder || t('components.skillTag.placeholder');

  function addSkill(raw) {
    const skill = (raw || '').trim();
    if (!skill) return;
    if (value.map((v) => v.toLowerCase()).includes(skill.toLowerCase())) return;
    onChange([...value, skill]);
  }

  function removeSkill(idx) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="border border-gray-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-transparent bg-white min-h-[44px]">
      <div className="flex flex-wrap gap-2 items-center">
        {value.map((skill, i) => (
          <span key={i} className="flex items-center gap-1 bg-blue-50 text-primary border border-blue-200 rounded-full px-3 py-0.5 text-sm font-medium">
            {skill}
            <button
              type="button"
              onClick={() => removeSkill(i)}
              aria-label={t('components.skillTag.remove', { skill })}
              className="text-blue-400 hover:text-primary ml-0.5 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <EscoSuggestInput
          value={input}
          onChange={setInput}
          onCommitEsco={(item) => addSkill(item.label)}
          onCommitCustom={(text) => addSkill(text)}
          onBackspaceEmpty={() => value.length > 0 && onChange(value.slice(0, -1))}
          placeholder={value.length === 0 ? effectivePlaceholder : ''}
          inputClassName="w-full outline-none text-sm py-0.5 bg-transparent"
          lang={lang}
          ariaLabel={ariaLabel || t('components.skillTag.ariaAdd')}
        />
      </div>
    </div>
  );
}
