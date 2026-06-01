import React from 'react';
import { useT } from '../i18n/index.jsx';

export default function BadgeDisplay({ badges = [] }) {
  const { t } = useT();
  if (!badges.length) return null;

  // Badge copy is defined server-side in English (badges_for RPC). Translate by
  // stable badge id when a locale key exists, otherwise fall back to the
  // server-provided text so new/unknown badges still render.
  const tr = (id, suffix, fallback) => {
    const key = `components.badge.${id}.${suffix}`;
    const val = t(key);
    return val === key ? fallback : val;
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {badges.map(badge => (
        <div
          key={badge.id}
          className={`rounded-xl p-4 text-center border transition-all ${
            badge.earned
              ? 'bg-white border-primary/30 shadow-sm'
              : 'bg-gray-50 border-gray-200 opacity-60'
          }`}
        >
          <div className={`text-3xl mb-2 ${badge.earned ? '' : 'grayscale'}`}>
            {badge.icon}
          </div>
          <div className={`text-sm font-semibold mb-1 ${badge.earned ? 'text-foreground' : 'text-gray-400'}`}>
            {tr(badge.id, 'label', badge.label)}
          </div>
          <div className={`text-xs ${badge.earned ? 'text-gray-500' : 'text-gray-400'}`}>
            {badge.earned ? tr(badge.id, 'description', badge.description) : tr(badge.id, 'condition', badge.condition)}
          </div>
        </div>
      ))}
    </div>
  );
}
