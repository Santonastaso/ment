import React, { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { useModalA11y } from '../lib/useModalA11y.js';
import { useT } from '../i18n/index.jsx';

// Visual overview of a user's skills as hairline row lists.
// `skillProgress` is the array returned from the server:
//   [{id, skill, type, example_project, session_count}]
// Each row opens a popup with the skill's tier, progress and example.

// ---------- Tier resolution ----------
function teachTier(n) {
  if (n >= 4) return 'expert';
  if (n >= 2) return 'trusted';
  if (n >= 1) return 'active';
  return 'untapped';
}
function learnTier(n) {
  if (n >= 3) return 'steady';
  if (n >= 2) return 'growing';
  if (n >= 1) return 'started';
  return 'missing';
}

const TEACH_ORDER = ['expert', 'trusted', 'active', 'untapped'];
const LEARN_ORDER = ['missing', 'started', 'growing', 'steady'];

// ---------- Skill row ----------
function SkillRow({ entry, kind, tierFn, order, isOwnProfile, onDelete }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const dialogRef = useModalA11y(open);
  const count = entry.session_count || 0;
  const tier = tierFn(count);
  const tierLabel = t(`components.skillLandscape.tier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`);

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
        className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
      >
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{entry.skill}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {count > 0 && <span className="tabular-nums">{count}</span>}
          <span>{tierLabel}</span>
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
            className="w-full max-w-md rounded-2xl bg-white [box-shadow:var(--shadow-overlay)]"
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
              <div>
                <p className="label-meta">{tierLabel}</p>
                <p className="mt-1 text-sm text-muted-foreground">{progressText}</p>
              </div>
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
function Section({ title, items, kind, tierFn, order, firstName, isOwnProfile, onDelete }) {
  if (items.length === 0) return null;

  // Sort: teach by tier desc (best first); learn by tier asc (gaps first to draw the eye)
  const sortIndex = (e) => order.indexOf(tierFn(e.session_count || 0));
  const sorted = [...items].sort((a, b) => sortIndex(a) - sortIndex(b));

  return (
    <section>
      <header className="mb-1 flex items-center gap-1.5">
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">({items.length})</span>
      </header>

      <div className="divide-y divide-[var(--border-subtle)]">
        {sorted.map((entry, i) => (
          <SkillRow
            key={entry.id ?? `${entry.skill}-${i}`}
            entry={entry}
            kind={kind}
            tierFn={tierFn}
            order={order}
            isOwnProfile={isOwnProfile}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

// ---------- Top-level component ----------
export default function SkillLandscape({ skillProgress = [], isOwnProfile, firstName, onDeleteSkill }) {
  const { t } = useT();
  const teach = skillProgress.filter(s => s.type === 'can_teach');
  const learn = skillProgress.filter(s => s.type === 'wants_to_learn');

  if (teach.length === 0 && learn.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        {isOwnProfile ? t('components.skillLandscape.emptyOwn') : t('components.skillLandscape.emptyOther')}
      </p>
    );
  }

  return (
    <div className="space-y-7">
      {/* Your strengths */}
      <Section
        title={isOwnProfile ? t('components.skillLandscape.shareTitleOwn') : t('components.skillLandscape.shareTitleOther', { name: firstName })}
        items={teach}
        kind="teach"
        tierFn={teachTier}
        order={TEACH_ORDER}
        firstName={firstName}
        isOwnProfile={isOwnProfile}
        onDelete={onDeleteSkill}
      />

      {/* Skills you're growing */}
      <Section
        title={isOwnProfile ? t('components.skillLandscape.growTitleOwn') : t('components.skillLandscape.growTitleOther', { name: firstName })}
        items={learn}
        kind="learn"
        tierFn={learnTier}
        order={LEARN_ORDER}
        firstName={firstName}
        isOwnProfile={isOwnProfile}
        onDelete={onDeleteSkill}
      />
    </div>
  );
}
