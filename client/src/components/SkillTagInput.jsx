import React, { useState } from 'react';

export default function SkillTagInput({ value = [], onChange, placeholder = 'Type a skill and press Enter' }) {
  const [input, setInput] = useState('');

  function addSkill(raw) {
    const skill = raw.trim().toLowerCase();
    if (skill && !value.map(v => v.toLowerCase()).includes(skill)) {
      onChange([...value, raw.trim()]);
    }
    setInput('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addSkill(input);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
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
              className="text-blue-400 hover:text-primary ml-0.5 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => input.trim() && addSkill(input)}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[140px] outline-none text-sm py-0.5 bg-transparent"
        />
      </div>
    </div>
  );
}
