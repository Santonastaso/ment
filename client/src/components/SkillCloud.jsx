import React, { useMemo, useState } from 'react';
import { Button } from './ui/button.jsx';
import { useT } from '../i18n/index.jsx';

// Overview's skill landscape, drawn as a word cloud: type size carries the
// ranking so nothing has to be numbered or listed. `skillProgress` is the
// array from skill_progress_for():
//   [{id, skill, type, example_project, session_count, evidence}]
// The Skills tab keeps the precise, editable list — this is the glanceable view.

const FILTERS = [
  { key: 'all', label: 'components.skillCloud.filterAll' },
  { key: 'can_teach', label: 'components.skillCloud.filterStrengths' },
  { key: 'wants_to_learn', label: 'components.skillCloud.filterGrowing' },
];

// Square-root scale: a skill with four conversations reads as clearly bigger
// than one with a single conversation, without shrinking the quiet ones past
// legibility. Range is 1em to 2.6em of the cloud's own font size.
function sizeEm(count, max) {
  return (1 + 1.6 * (count / max) ** 0.6).toFixed(3);
}

// Untouched skills sit back rather than being flagged as missing.
function opacityFor(count, max) {
  return (0.62 + 0.38 * Math.sqrt(count / max)).toFixed(3);
}

// Alternating around the centre puts the biggest words in the middle of the
// wrapped block, so it reads as a mass instead of a descending list.
function centreOrder(items) {
  const sorted = [...items].sort(
    (a, b) => b.session_count - a.session_count || a.skill.localeCompare(b.skill)
  );
  const out = [];
  sorted.forEach((entry, index) => { if (index % 2) out.unshift(entry); else out.push(entry); });
  return out;
}

const identity = (entry) => `${entry.type}:${entry.skill}`;

export default function SkillCloud({ skillProgress = [], isOwnProfile, onDeleteSkill }) {
  const { t } = useT();
  const [filter, setFilter] = useState('all');
  const [selectedKey, setSelectedKey] = useState(null);

  const entries = useMemo(
    () => skillProgress.map(entry => ({ ...entry, session_count: entry.session_count || 0 })),
    [skillProgress]
  );

  const visible = useMemo(
    () => entries.filter(entry => filter === 'all' || entry.type === filter),
    [entries, filter]
  );

  // Scale against the busiest skill on screen, and never divide by zero when
  // nothing has been discussed yet.
  const max = useMemo(
    () => Math.max(1, ...visible.map(entry => entry.session_count)),
    [visible]
  );

  const selected = useMemo(() => {
    const found = visible.find(entry => identity(entry) === selectedKey);
    if (found) return found;
    return [...visible].sort((a, b) => b.session_count - a.session_count)[0] || null;
  }, [visible, selectedKey]);

  function countLabel(count) {
    if (count === 0) return t('components.skillCloud.noneYet');
    return count === 1
      ? t('components.skillCloud.conversationsOne', { count })
      : t('components.skillCloud.conversationsMany', { count });
  }

  if (!entries.length) {
    return <p className="text-sm text-muted-foreground">{t('components.skillLandscape.emptyList')}</p>;
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <div className="skill-cloud-filters" role="group" aria-label={t('components.skillCloud.filterLabel')}>
          {FILTERS.map(option => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="skill-cloud-stage">
        <div className="skill-cloud" role="group" aria-label={t('components.skillCloud.cloudLabel')}>
          {centreOrder(visible).map(entry => {
            const key = identity(entry);
            const isSelected = selected && identity(selected) === key;
            const kind = entry.type === 'can_teach'
              ? t('components.skillCloud.kindStrength')
              : t('components.skillCloud.kindGrowing');
            return (
              <button
                key={entry.id ?? key}
                type="button"
                aria-pressed={Boolean(isSelected)}
                aria-label={`${entry.skill} — ${kind}, ${countLabel(entry.session_count)}`}
                onClick={() => setSelectedKey(key)}
                className={`skill-cloud-word ${entry.type === 'wants_to_learn' ? 'is-growing' : ''}`}
                style={{
                  fontSize: `${sizeEm(entry.session_count, max)}em`,
                  opacity: opacityFor(entry.session_count, max),
                }}
              >
                {entry.skill}
              </button>
            );
          })}
          {visible.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('components.skillLandscape.emptyList')}</p>
          )}
        </div>

        <div className="skill-cloud-legend">
          <span><i className="skill-cloud-swatch" aria-hidden="true" />{t('components.skillCloud.filterStrengths')}</span>
          <span><i className="skill-cloud-swatch is-growing" aria-hidden="true" />{t('components.skillCloud.filterGrowing')}</span>
          <span>{t('components.skillCloud.legendSize')}</span>
        </div>
      </div>

      {selected && (
        <div className="skill-cloud-detail" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-[15px] font-medium text-foreground">{selected.skill}</h3>
            <span className="label-meta">
              {selected.type === 'can_teach'
                ? t('components.skillCloud.kindStrength')
                : t('components.skillCloud.kindGrowing')}
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground">{countLabel(selected.session_count)}</p>

          {selected.example_project && (
            <div>
              <p className="label-meta">{t('components.skillLandscape.exampleLabel')}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{selected.example_project}</p>
            </div>
          )}

          {selected.evidence?.length > 0 && (
            <div>
              <p className="label-meta">{t('components.skillCloud.cameUpWith')}</p>
              <ul className="mt-1 space-y-0.5">
                {selected.evidence.map(item => (
                  <li
                    key={`${item.session_id}-${item.person_id}`}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    <span>{item.person_name}</span>
                    <time className="text-xs tabular-nums text-muted-foreground">
                      {new Date(item.occurred_at).toLocaleDateString()}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isOwnProfile && onDeleteSkill && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 mt-1 self-start text-destructive hover:text-destructive"
              onClick={() => { onDeleteSkill(selected); setSelectedKey(null); }}
            >
              {t('components.skillLandscape.removeSkill', { skill: selected.skill })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
