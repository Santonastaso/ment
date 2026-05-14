import React from 'react';

// Maps a viewer-adjusted match score (0-100) to a 1-5 affinity level.
// The current matching algorithm's max practical score is ~85 (40 skill + 20
// career + 25 diversity), so the bands are tuned to that range rather than
// to a literal 0-100 scale.
function scoreToDots(score) {
  if (score >= 70) return 5;
  if (score >= 55) return 4;
  if (score >= 45) return 3;
  if (score >= 35) return 2;
  return 1;
}

function scoreToLabel(score) {
  if (score >= 70) return 'Strong match';
  if (score >= 50) return 'Promising match';
  return 'Worth a look';
}

export default function AffinityIndicator({ score = 0, showLabel = true, size = 'md' }) {
  const dots = scoreToDots(score);
  const label = scoreToLabel(score);
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';
  const gap = size === 'sm' ? 'gap-0.5' : 'gap-1';

  return (
    <div className="inline-flex items-center gap-2">
      <div
        className={`flex items-center ${gap}`}
        aria-label={`Affinity: ${dots} of 5 — ${label}`}
        title={`Affinity score: ${score}/100`}
      >
        {[1, 2, 3, 4, 5].map(i => (
          <span
            key={i}
            className={`${dotSize} rounded-full transition-colors ${
              i <= dots ? 'bg-navy' : 'bg-surface-border'
            }`}
          />
        ))}
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-ink-secondary">{label}</span>
      )}
    </div>
  );
}
