import React from 'react';
import { useT } from '../i18n/index.jsx';

function scoreToDots(score) {
  if (score >= 70) return 5;
  if (score >= 55) return 4;
  if (score >= 45) return 3;
  if (score >= 35) return 2;
  return 1;
}

function scoreToLabelKey(score) {
  if (score >= 70) return 'components.affinity.strong';
  if (score >= 50) return 'components.affinity.promising';
  return 'components.affinity.worth';
}

export default function AffinityIndicator({ score = 0, showLabel = true, size = 'md' }) {
  const { t } = useT();
  const dots = scoreToDots(score);
  const label = t(scoreToLabelKey(score));
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';
  const gap = size === 'sm' ? 'gap-0.5' : 'gap-1';

  return (
    <div className="inline-flex items-center gap-2">
      <div className={`flex items-center ${gap}`} aria-label={t('components.affinity.aria', { dots, label })} title={t('components.affinity.title', { score })}>
        {[1, 2, 3, 4, 5].map(i => (
          <span
            key={i}
            className={`${dotSize} rounded-full transition-colors ${i <= dots ? 'bg-primary' : 'bg-border'}`}
          />
        ))}
      </div>
      {showLabel && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
    </div>
  );
}
