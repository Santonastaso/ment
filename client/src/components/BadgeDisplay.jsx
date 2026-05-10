import React from 'react';

export default function BadgeDisplay({ badges = [] }) {
  if (!badges.length) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {badges.map(badge => (
        <div
          key={badge.id}
          className={`rounded-xl p-4 text-center border transition-all ${
            badge.earned
              ? 'bg-white border-navy-light shadow-sm'
              : 'bg-gray-50 border-gray-200 opacity-60'
          }`}
        >
          <div className={`text-3xl mb-2 ${badge.earned ? '' : 'grayscale'}`}>
            {badge.icon}
          </div>
          <div className={`text-sm font-semibold mb-1 ${badge.earned ? 'text-navy' : 'text-gray-400'}`}>
            {badge.label}
          </div>
          <div className={`text-xs ${badge.earned ? 'text-gray-500' : 'text-gray-400'}`}>
            {badge.earned ? badge.description : badge.condition}
          </div>
        </div>
      ))}
    </div>
  );
}
