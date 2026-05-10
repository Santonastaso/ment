import React, { useState } from 'react';

// Visual, interactive overview of a user's skills.
// Uses bubble-style chips with a red→green spectrum for "growing" skills (gaps you're closing)
// and a blue→gold spectrum for "shared" skills (what you can teach).
//
// `skillProgress` is the array returned from the server:
//   [{id, skill, type, example_project, session_count}]

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

// ---------- Visual presets ----------
// Each preset returns { bubble: tailwind classes, dot: legend dot color, label }
const teachPresets = {
  untapped: {
    bubble: 'bg-blue-50 text-navy border border-blue-200 hover:bg-blue-100',
    dot: 'bg-blue-200',
    label: 'Untapped',
    extraClass: '',
  },
  active: {
    bubble: 'bg-blue-100 text-navy border border-navy-light hover:bg-blue-200',
    dot: 'bg-navy-light',
    label: 'Active',
    extraClass: '',
  },
  trusted: {
    bubble: 'bg-navy text-white border border-navy hover:bg-navy-dark',
    dot: 'bg-navy',
    label: 'Trusted',
    extraClass: '',
  },
  expert: {
    bubble: 'bg-gradient-to-r from-amber-300 to-yellow-500 text-amber-950 border border-amber-500 font-semibold',
    dot: 'bg-amber-400',
    label: 'Deep expert',
    extraClass: 'skill-bubble-glow',
  },
};

const learnPresets = {
  missing: {
    bubble: 'bg-rose-50 text-rose-700 border border-rose-300 border-dashed hover:bg-rose-100',
    dot: 'bg-rose-400',
    label: 'Missing',
    extraClass: 'skill-bubble-pulse-red',
  },
  started: {
    bubble: 'bg-orange-50 text-orange-800 border border-orange-300 hover:bg-orange-100',
    dot: 'bg-orange-400',
    label: 'Just started',
    extraClass: '',
  },
  growing: {
    bubble: 'bg-lime-50 text-lime-800 border border-lime-400 hover:bg-lime-100',
    dot: 'bg-lime-500',
    label: 'Growing',
    extraClass: '',
  },
  steady: {
    bubble: 'bg-emerald-100 text-emerald-900 border border-emerald-500 font-semibold hover:bg-emerald-200',
    dot: 'bg-emerald-500',
    label: 'Steady',
    extraClass: '',
  },
};

const TEACH_ORDER = ['expert', 'trusted', 'active', 'untapped'];
const LEARN_ORDER = ['missing', 'started', 'growing', 'steady'];

// ---------- Bubble component ----------
function Bubble({ entry, kind, tier, preset, index, isOwnProfile, onDelete }) {
  const [hover, setHover] = useState(false);
  const count = entry.session_count || 0;
  const sizeClass = kind === 'teach'
    ? (count >= 4 ? 'text-sm pl-4 pr-3 py-2' : count >= 2 ? 'text-sm pl-3.5 pr-2.5 py-1.5' : 'text-sm pl-3 pr-2 py-1.5')
    : (count >= 3 ? 'text-sm pl-4 pr-3 py-2' : count >= 1 ? 'text-sm pl-3.5 pr-2.5 py-1.5' : 'text-sm pl-3 pr-2 py-1.5');
  const animClass = preset.extraClass || 'skill-bubble';

  const tooltipText = (() => {
    if (kind === 'teach') {
      const sessions = `${count} mentoring session${count === 1 ? '' : 's'}`;
      return entry.example_project
        ? `${entry.example_project}\n\n${sessions} so far`
        : (count > 0 ? sessions : 'No mentoring sessions yet — your first match could change that.');
    }
    if (count === 0) return 'You have not explored this skill yet.';
    return `${count} session${count === 1 ? '' : 's'} attended on this topic so far.`;
  })();

  const isExpert = tier === 'expert';
  const closeBtnTone = isExpert
    ? 'bg-amber-950/15 hover:bg-amber-950/30 text-amber-950'
    : kind === 'teach'
      ? 'bg-white/60 hover:bg-white text-navy'
      : 'bg-white/70 hover:bg-white text-gray-700 hover:text-rose-600';

  function handleDelete(e) {
    e.stopPropagation();
    onDelete?.(entry);
  }

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className={[
          'rounded-full inline-flex items-center gap-2 transition-all duration-200',
          'hover:scale-[1.06] hover:shadow-md cursor-default',
          animClass, sizeClass, preset.bubble,
        ].join(' ')}
        style={{ animationDelay: `${index * 30}ms` }}
        tabIndex={0}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        <span>{entry.skill}</span>
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[11px] font-semibold bg-white/70 text-gray-800">
            {count}
          </span>
        )}
        {isExpert && <span className="text-base leading-none">★</span>}
        {isOwnProfile && onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            aria-label={`Remove ${entry.skill}`}
            title="Remove this skill"
            className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[12px] leading-none ${closeBtnTone} transition-colors`}
          >
            ×
          </button>
        )}
      </div>

      {/* Hover popover */}
      {hover && (
        <div className="absolute z-30 left-1/2 -translate-x-1/2 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs text-gray-700 leading-relaxed pointer-events-none whitespace-pre-line">
          <div className="font-semibold text-navy mb-1">{entry.skill}</div>
          <div className="text-[10px] uppercase tracking-wide font-medium mb-1.5"
            style={{ color: kind === 'teach' && tier === 'expert' ? '#92400e' : kind === 'teach' ? '#1B3A5C' : tier === 'missing' ? '#be123c' : '#15803d' }}>
            {preset.label}
          </div>
          {tooltipText}
        </div>
      )}
    </div>
  );
}

// ---------- Legend ----------
function Legend({ presets, order }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
      {order.map(key => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${presets[key].dot}`} />
          {presets[key].label}
        </span>
      ))}
    </div>
  );
}

// ---------- Section ----------
function Section({ title, subtitle, items, kind, tierFn, presets, order, firstName, isOwnProfile, onDelete }) {
  if (items.length === 0) return null;

  // Sort: teach by tier desc (best first); learn by tier asc (gaps first to draw the eye)
  const sortIndex = (e) => order.indexOf(tierFn(e.session_count || 0));
  const sorted = [...items].sort((a, b) => sortIndex(a) - sortIndex(b));

  return (
    <section>
      <header className="mb-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-semibold text-navy">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <Legend presets={presets} order={order} />
        </div>
      </header>

      <div className="flex flex-wrap gap-2.5">
        {sorted.map((entry, i) => {
          const tier = tierFn(entry.session_count || 0);
          return (
            <Bubble
              key={entry.id}
              entry={entry}
              kind={kind}
              tier={tier}
              preset={presets[tier]}
              index={i}
              isOwnProfile={isOwnProfile}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </section>
  );
}

// ---------- Top-level component ----------
export default function SkillLandscape({ skillProgress = [], isOwnProfile, firstName, onDeleteSkill }) {
  const teach = skillProgress.filter(s => s.type === 'can_teach');
  const learn = skillProgress.filter(s => s.type === 'wants_to_learn');

  if (teach.length === 0 && learn.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">
        {isOwnProfile ? 'Add some skills below to see your landscape.' : 'No skills listed yet.'}
      </p>
    );
  }

  const totalLearning = learn.length;
  const totalGrowing = learn.filter(s => (s.session_count || 0) > 0).length;
  const totalTeaching = teach.length;
  const totalActiveTeaching = teach.filter(s => (s.session_count || 0) > 0).length;

  return (
    <div className="space-y-7">
      {/* Headline summary */}
      {(totalLearning > 0 || totalTeaching > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {totalTeaching > 0 && (
            <div className="bg-blue-50 rounded-xl px-4 py-3 border border-blue-200">
              <div className="text-2xl font-bold text-navy leading-none">
                {totalActiveTeaching}<span className="text-gray-400 text-lg font-medium">/{totalTeaching}</span>
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {isOwnProfile ? 'skills you’re actively teaching' : `skills ${firstName} actively teaches`}
              </div>
            </div>
          )}
          {totalLearning > 0 && (
            <div className={`rounded-xl px-4 py-3 border ${totalGrowing > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
              <div className={`text-2xl font-bold leading-none ${totalGrowing > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {totalGrowing}<span className="text-gray-400 text-lg font-medium">/{totalLearning}</span>
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {isOwnProfile ? 'learning goals you’ve started' : `learning goals ${firstName} has started`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Skills you share */}
      <Section
        title={isOwnProfile ? 'Skills you share' : `What ${firstName} shares`}
        subtitle={
          isOwnProfile
            ? 'Topics you can mentor on. Bubbles deepen and gild as you complete sessions. Click × on any bubble to remove it.'
            : 'Topics they can mentor on.'
        }
        items={teach}
        kind="teach"
        tierFn={teachTier}
        presets={teachPresets}
        order={TEACH_ORDER}
        firstName={firstName}
        isOwnProfile={isOwnProfile}
        onDelete={onDeleteSkill}
      />

      {/* Skills you're growing — red→green */}
      <Section
        title={isOwnProfile ? 'Skills you’re growing' : `What ${firstName} wants to learn`}
        subtitle={
          isOwnProfile
            ? 'Red bubbles are gaps you haven’t explored yet — green bubbles light up as you take sessions on them. Click × to remove.'
            : 'Areas they want to develop. Red are gaps; green are areas they’re actively exploring.'
        }
        items={learn}
        kind="learn"
        tierFn={learnTier}
        presets={learnPresets}
        order={LEARN_ORDER}
        firstName={firstName}
        isOwnProfile={isOwnProfile}
        onDelete={onDeleteSkill}
      />
    </div>
  );
}
