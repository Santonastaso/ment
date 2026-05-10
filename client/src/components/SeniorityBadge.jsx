import React from 'react';

const styles = {
  junior:  'bg-gray-100 text-gray-600',
  mid:     'bg-blue-100 text-blue-700',
  senior:  'bg-[#1B3A5C] text-white',
  lead:    'bg-yellow-400 text-yellow-900',
};

export default function SeniorityBadge({ seniority }) {
  const label = seniority ? seniority.charAt(0).toUpperCase() + seniority.slice(1) : '';
  const cls = styles[seniority] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}
