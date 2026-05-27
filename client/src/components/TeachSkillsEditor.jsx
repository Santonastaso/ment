import React, { useState } from 'react';
import EscoSuggestInput from './EscoSuggestInput.jsx';

// Edits an array of { skill, example_project } pairs. Used for "what you can
// teach" where the spec calls for an optional example project per skill.
// ESCO autocomplete is suggestive: confirm a custom string with Enter to skip.
export default function TeachSkillsEditor({ value = [], onChange, placeholder = 'e.g. system design, financial modeling…', lang, ariaLabel }) {
  const [skillInput, setSkillInput] = useState('');

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
      <div className="border border-gray-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-transparent bg-white min-h-[44px]">
        <EscoSuggestInput
          value={skillInput}
          onChange={setSkillInput}
          onCommitEsco={(item) => addSkill(item.label)}
          onCommitCustom={(text) => addSkill(text)}
          onBackspaceEmpty={() => value.length > 0 && onChange(value.slice(0, -1))}
          placeholder={value.length === 0 ? placeholder : 'Add another skill — Enter to confirm'}
          inputClassName="w-full outline-none text-sm py-0.5 bg-transparent"
          lang={lang}
          ariaLabel={ariaLabel || 'Add skill you can teach'}
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
                placeholder="Example project (optional) — what shows you've done this?"
                className="flex-1 min-w-0 outline-none text-sm bg-transparent border-b border-transparent focus:border-primary py-1"
              />
              <button
                type="button"
                onClick={() => removeSkill(i)}
                className="text-gray-400 hover:text-red-500 text-sm flex-shrink-0 mt-1"
                aria-label={`Remove ${entry.skill}`}
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
