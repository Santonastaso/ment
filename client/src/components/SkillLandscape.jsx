import React, { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { useModalA11y } from '../lib/useModalA11y.js';
import { useT } from '../i18n/index.jsx';

// Visual overview of a user's skills as hairline row lists.
// `skillProgress` is the array returned from the server:
//   [{id, skill, type, example_project, session_count}]
// Each row opens a popup with the skill's tier, progress and example.

// ---------- Skill row ----------
function SkillRow({ entry, kind, isOwnProfile, onDelete }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const dialogRef = useModalA11y(open);
  const count = entry.session_count || 0;

  // Close the popup on Escape.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const progressText = (() => {
    if (kind === 'teach') {
      if (count === 0) return t('components.skillLandscape.tooltipNoSessions');
      return count === 1
        ? t('components.skillLandscape.tooltipSoFar', { sessions: t('components.skillLandscape.tooltipSessionsOne', { count }) })
        : t('components.skillLandscape.tooltipSoFar', { sessions: t('components.skillLandscape.tooltipSessionsMany', { count }) });
    }
    if (count === 0) return t('components.skillLandscape.tooltipNotExplored');
    return count === 1
      ? t('components.skillLandscape.tooltipAttendedOne', { count })
      : t('components.skillLandscape.tooltipAttendedMany', { count });
  })();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full items-center justify-between gap-3 rounded-full px-3 py-2 text-left hover:bg-[var(--control-surface)]"
      >
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{entry.skill}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {count > 0 && <span className="tabular-nums">{count}</span>}
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </span>
      </button>

      {/* Popup — tier, progress, example, remove. */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`skill-row-title-${entry.id ?? entry.skill}`}
            className="w-full max-w-md rounded-[10px] border border-[var(--border)] bg-card [box-shadow:var(--shadow-overlay)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-5">
              <h2 id={`skill-row-title-${entry.id ?? entry.skill}`} className="text-base font-medium leading-snug text-foreground">
                {entry.skill}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('components.session.close')}
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </div>

            <div className="space-y-4 p-5">
              {count > 0 && <p className="text-sm text-muted-foreground">{progressText}</p>}
              {entry.example_project && (
                <div>
                  <p className="label-meta">{t('components.skillLandscape.exampleLabel')}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{entry.example_project}</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] p-4">
              {isOwnProfile && onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => { onDelete(entry); setOpen(false); }}
                >
                  {t('components.skillLandscape.removeSkill', { skill: entry.skill })}
                </Button>
              )}
              <Button type="button" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
                {t('components.popup.done')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Section ----------
function Section({ title, items, kind, isOwnProfile, onDelete }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 3);

  return (
    <section>
      <header className="mb-1 flex items-center gap-1.5">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">({items.length})</span>
      </header>

      <div className="grid gap-0.5">
        {visible.map((entry, i) => (
          <SkillRow
            key={entry.id ?? `${entry.skill}-${i}`}
            entry={entry}
            kind={kind}
            isOwnProfile={isOwnProfile}
            onDelete={onDelete}
          />
        ))}
      </div>
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t('components.skillLandscape.emptyList')}</p>}
      {items.length > 3 && <Button type="button" size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{t(expanded ? 'components.skillLandscape.showLess' : 'components.skillLandscape.showAll', { count: items.length })}</Button>}
    </section>
  );
}

// ---------- Top-level component ----------
export default function SkillLandscape({ skillProgress = [], isOwnProfile, firstName, onDeleteSkill }) {
  const { t } = useT();
  const teach = skillProgress.filter(s => s.type === 'can_teach');
  const learn = skillProgress.filter(s => s.type === 'wants_to_learn');

  return (
    <div className="grid min-w-0 gap-5 sm:grid-cols-2">
      {/* Your strengths */}
      <Section
        title={isOwnProfile ? t('components.skillLandscape.shareTitleOwn') : t('components.skillLandscape.shareTitleOther', { name: firstName })}
        items={teach}
        kind="teach"
        firstName={firstName}
        isOwnProfile={isOwnProfile}
        onDelete={onDeleteSkill}
      />

      {/* Skills you're growing */}
      <Section
        title={isOwnProfile ? t('components.skillLandscape.growTitleOwn') : t('components.skillLandscape.growTitleOther', { name: firstName })}
        items={learn}
        kind="learn"
        firstName={firstName}
        isOwnProfile={isOwnProfile}
        onDelete={onDeleteSkill}
      />
    </div>
  );
}
