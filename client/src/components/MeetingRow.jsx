import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import RatingPicker from './RatingPicker.jsx';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';

// Shared collapsed/expandable row used by both Past and Upcoming meetings.
//
// `mode` is 'past' or 'upcoming' and only changes a few labels and the
// "awaiting mark-as-complete" hint. The row visualizes:
//   - Counterpart avatar + name (link to profile)
//   - Role badge: "You're the mentor" (navy) or "You're the mentee" (amber)
//   - Date + relative time
//   - Top 2 topic chips inline (the rest are visible when expanded)
//
// In the expanded view: full topics list, the original focus question, and
// (for past meetings) the mentee's private reflection where applicable.
export default function MeetingRow({ session, currentUserId, mode = 'past', onUpdate }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [editingReflection, setEditingReflection] = useState(false);
  const [reflectionDraft, setReflectionDraft] = useState('');
  const [ratingDraft, setRatingDraft] = useState(null);
  const [savingReflection, setSavingReflection] = useState(false);

  const isMentor = session.mentor?.id === currentUserId;
  const counterpart = isMentor ? session.mentee : session.mentor;
  const hasDate = !!session.scheduled_at;
  const date = hasDate ? new Date(session.scheduled_at) : null;
  const dateLabel = hasDate ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
  const timeLabel = hasDate ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
  const relative = hasDate
    ? (mode === 'upcoming' ? upcomingRelative(date, t) : pastRelative(date, t))
    : null;
  const awaitingMark = mode === 'past' && session.status === 'scheduled';

  // Status badge tells the user where the session is in the lifecycle.
  // Pending: someone hasn't accepted yet. Direction matters.
  let statusBadge = null;
  if (session.status === 'pending') {
    statusBadge = isMentor
      ? { label: t('components.meeting.statusAwaitingYours'), className: 'bg-amber-100 text-amber-800 border border-amber-300' }
      : { label: t('components.meeting.statusAwaitingTheirs'), className: 'bg-amber-50 text-amber-700 border border-amber-200' };
  } else if (session.status === 'scheduled' && !hasDate) {
    statusBadge = { label: t('components.meeting.statusConfirmedNoDate'), className: 'bg-blue-50 text-primary border border-blue-200' };
  }

  const topics = session.topics || [];
  const visibleTopics = topics.slice(0, 2);
  const extraTopics = Math.max(0, topics.length - visibleTopics.length);

  const roleBadge = isMentor
    ? { label: t('components.meeting.roleMentor'), className: 'bg-primary text-primary-foreground' }
    : { label: t('components.meeting.roleMentee'), className: 'bg-amber-100 text-amber-800 border border-amber-300' };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left p-4 hover:bg-gray-50 transition-colors flex items-start gap-3"
      >
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-semibold flex-shrink-0">
          {counterpart?.name?.charAt(0)}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-foreground">{session.title}</span>
            {hasDate ? (
              <>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500">
                  {dateLabel}{timeLabel ? ` ${t('components.meeting.at')} ${timeLabel}` : ''}
                </span>
              </>
            ) : (
              <>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500 italic">{t('components.meeting.noDateProposed')}</span>
              </>
            )}
            {relative && (
              <span className="text-[10px] uppercase tracking-wide bg-blue-50 text-primary border border-blue-200 rounded-full px-2 py-0.5">
                {relative}
              </span>
            )}
            {statusBadge && (
              <span className={`text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 ${statusBadge.className}`}>
                {statusBadge.label}
              </span>
            )}
            {awaitingMark && (
              <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
                {t('components.meeting.awaitingMark')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 font-medium ${roleBadge.className}`}>
              {roleBadge.label}
            </span>
            <span className="text-xs text-gray-600">
              {t('components.meeting.with')}{' '}
              <Link to={`/profile/${counterpart?.id}`} className="text-primary hover:underline" onClick={e => e.stopPropagation()}>
                {counterpart?.name}
              </Link>
              <span className="text-gray-400"> · {counterpart?.department}</span>
            </span>
          </div>
          {visibleTopics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {visibleTopics.map((t, i) => (
                <span key={i} className="bg-blue-50 text-primary border border-blue-200 rounded-full px-2 py-0.5 text-[11px] font-medium">
                  {t}
                </span>
              ))}
              {extraTopics > 0 && (
                <span className="text-[11px] text-gray-500 italic">{t('components.meeting.moreOne', { count: extraTopics })}</span>
              )}
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0 mt-1">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 text-sm space-y-3 border-t border-gray-100 bg-gray-50/50">
          {topics.length > visibleTopics.length && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium mb-1.5">
                {mode === 'upcoming' ? t('components.meeting.topicsToCover') : t('components.meeting.topicsCovered')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {topics.map((t, i) => (
                  <span key={i} className="bg-blue-50 text-primary border border-blue-200 rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {session.pre_session_question && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium mb-0.5">{t('components.meeting.focusQuestion')}</p>
              <p className="text-gray-700 italic">“{session.pre_session_question}”</p>
            </div>
          )}
          {mode === 'past' && (() => {
            // Each side has their own private reflection AND their own private rating.
            // Show only your own, and let the user add or edit ex-post.
            const myReflection = isMentor ? session.mentor_reflection : session.reflection;
            const myRating = isMentor ? session.mentor_rating : session.mentee_rating;
            const reflectionField = isMentor ? 'mentor_reflection' : 'reflection';
            const ratingField = isMentor ? 'mentor_rating' : 'mentee_rating';
            const reflectionPrompt = isMentor
              ? t('components.meeting.reflectionPromptMentor')
              : t('components.meeting.reflectionPromptMentee');
            const partnerName = counterpart?.name?.split(' ')[0] || t('components.meeting.theyFallback');

            async function saveReflection() {
              setSavingReflection(true);
              try {
                const body = { [reflectionField]: reflectionDraft.trim() };
                if (ratingDraft !== null) body[ratingField] = ratingDraft;
                await api.put(`/sessions/${session.id}`, body);
                setEditingReflection(false);
                onUpdate?.();
              } finally {
                setSavingReflection(false);
              }
            }

            if (editingReflection) {
              return (
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium mb-0.5">{t('components.meeting.yourReflectionPrivate')}</p>
                    <p className="text-xs text-gray-600 mb-1">{reflectionPrompt}</p>
                    <textarea
                      className="input resize-none text-sm"
                      rows={3}
                      value={reflectionDraft}
                      onChange={e => setReflectionDraft(e.target.value)}
                      placeholder={t('components.meeting.reflectionPlaceholder')}
                      autoFocus
                    />
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium mb-0.5">{t('components.meeting.yourRatingPrivate')}</p>
                    <RatingPicker value={ratingDraft} onChange={setRatingDraft} />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveReflection}
                      disabled={savingReflection || (!reflectionDraft.trim() && ratingDraft === null)}
                      className="btn-primary text-sm"
                    >
                      {savingReflection ? t('components.meeting.saving') : t('components.meeting.save')}
                    </button>
                    <button
                      onClick={() => { setEditingReflection(false); setReflectionDraft(''); setRatingDraft(null); }}
                      className="btn-ghost text-sm"
                    >
                      {t('components.meeting.cancel')}
                    </button>
                  </div>
                </div>
              );
            }

            if (myReflection || myRating) {
              return (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">{t('components.meeting.yourReflectionPrivate')}</p>
                    <button
                      onClick={() => { setReflectionDraft(myReflection || ''); setRatingDraft(myRating ?? null); setEditingReflection(true); }}
                      className="text-xs text-primary hover:text-foreground font-medium"
                    >
                      {t('components.meeting.edit')}
                    </button>
                  </div>
                  {myReflection && <p className="text-gray-700 whitespace-pre-wrap">{myReflection}</p>}
                  {myRating && (
                    <div className="text-xs text-gray-500">
                      {t('components.meeting.yourRating')}<RatingPicker value={myRating} onChange={() => {}} disabled showHint={false} />
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div>
                <p className="text-gray-400 text-xs italic mb-2">
                  {t('components.meeting.noReflection', { name: partnerName })}
                </p>
                <button
                  onClick={() => { setReflectionDraft(''); setRatingDraft(null); setEditingReflection(true); }}
                  className="btn-secondary text-xs"
                >
                  {t('components.meeting.addReflection')}
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// Helpers — produce short, human-friendly relative time strings.
function pastRelative(date, t) {
  const ms = Date.now() - date.getTime();
  if (ms < 0) return null;
  const days = Math.floor(ms / 86400000);
  if (days === 0) return t('components.meeting.relToday');
  if (days === 1) return t('components.meeting.relYesterday');
  if (days < 7) return t('components.meeting.relDaysAgo', { count: days });
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1
      ? t('components.meeting.relWeekAgo', { count: weeks })
      : t('components.meeting.relWeeksAgo', { count: weeks });
  }
  return null;
}
function upcomingRelative(date, t) {
  const ms = date.getTime() - Date.now();
  if (ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return minutes <= 1 ? t('components.meeting.relInMinLt1') : t('components.meeting.relInMin', { count: minutes });
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return hours === 1 ? t('components.meeting.relInHour', { count: hours }) : t('components.meeting.relInHours', { count: hours });
  const days = Math.floor(ms / 86400000);
  if (days === 0) return t('components.meeting.relToday');
  if (days === 1) return t('components.meeting.relTomorrow');
  if (days < 7) return t('components.meeting.relInDays', { count: days });
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1
      ? t('components.meeting.relInWeek', { count: weeks })
      : t('components.meeting.relInWeeks', { count: weeks });
  }
  return null;
}
