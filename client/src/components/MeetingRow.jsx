import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/index.js';

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
  const [expanded, setExpanded] = useState(false);
  const [editingReflection, setEditingReflection] = useState(false);
  const [reflectionDraft, setReflectionDraft] = useState('');
  const [savingReflection, setSavingReflection] = useState(false);

  const isMentor = session.mentor?.id === currentUserId;
  const counterpart = isMentor ? session.mentee : session.mentor;
  const hasDate = !!session.scheduled_at;
  const date = hasDate ? new Date(session.scheduled_at) : null;
  const dateLabel = hasDate ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
  const timeLabel = hasDate ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
  const relative = hasDate
    ? (mode === 'upcoming' ? upcomingRelative(date) : pastRelative(date))
    : null;
  const awaitingMark = mode === 'past' && session.status === 'scheduled';

  // Status badge tells the user where the session is in the lifecycle.
  // Pending: someone hasn't accepted yet. Direction matters.
  let statusBadge = null;
  if (session.status === 'pending') {
    statusBadge = isMentor
      ? { label: 'Awaiting your acceptance', className: 'bg-amber-100 text-amber-800 border border-amber-300' }
      : { label: 'Awaiting their acceptance', className: 'bg-amber-50 text-amber-700 border border-amber-200' };
  } else if (session.status === 'scheduled' && !hasDate) {
    statusBadge = { label: 'Confirmed — date to be set', className: 'bg-blue-50 text-navy-light border border-blue-200' };
  }

  const topics = session.topics || [];
  const visibleTopics = topics.slice(0, 2);
  const extraTopics = Math.max(0, topics.length - visibleTopics.length);

  const roleBadge = isMentor
    ? { label: "You're the mentor", className: 'bg-navy text-white' }
    : { label: "You're the mentee", className: 'bg-amber-100 text-amber-800 border border-amber-300' };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left p-4 hover:bg-gray-50 transition-colors flex items-start gap-3"
      >
        <div className="w-10 h-10 rounded-full bg-navy-light flex items-center justify-center text-white font-semibold flex-shrink-0">
          {counterpart?.name?.charAt(0)}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-navy">{session.title}</span>
            {hasDate ? (
              <>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500">
                  {dateLabel}{timeLabel ? ` at ${timeLabel}` : ''}
                </span>
              </>
            ) : (
              <>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500 italic">no date proposed</span>
              </>
            )}
            {relative && (
              <span className="text-[10px] uppercase tracking-wide bg-blue-50 text-navy-light border border-blue-200 rounded-full px-2 py-0.5">
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
                Awaiting your mark-as-complete
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 font-medium ${roleBadge.className}`}>
              {roleBadge.label}
            </span>
            <span className="text-xs text-gray-600">
              with{' '}
              <Link to={`/profile/${counterpart?.id}`} className="text-navy-light hover:underline" onClick={e => e.stopPropagation()}>
                {counterpart?.name}
              </Link>
              <span className="text-gray-400"> · {counterpart?.department}</span>
            </span>
          </div>
          {visibleTopics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {visibleTopics.map((t, i) => (
                <span key={i} className="bg-blue-50 text-navy-light border border-blue-200 rounded-full px-2 py-0.5 text-[11px] font-medium">
                  {t}
                </span>
              ))}
              {extraTopics > 0 && (
                <span className="text-[11px] text-gray-500 italic">+{extraTopics} more</span>
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
                {mode === 'upcoming' ? 'Topics to cover' : 'Topics covered'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {topics.map((t, i) => (
                  <span key={i} className="bg-blue-50 text-navy-light border border-blue-200 rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {session.pre_session_question && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium mb-0.5">Focus question</p>
              <p className="text-gray-700 italic">“{session.pre_session_question}”</p>
            </div>
          )}
          {mode === 'past' && (() => {
            // Each side has their own private reflection. Show only your own,
            // and let the user add or edit it ex-post (after the session is over).
            const myReflection = isMentor ? session.mentor_reflection : session.reflection;
            const reflectionField = isMentor ? 'mentor_reflection' : 'reflection';
            const reflectionPrompt = isMentor
              ? 'What did you take away from supporting them?'
              : 'What is one thing you will do differently based on this conversation?';
            const partnerName = counterpart?.name?.split(' ')[0] || 'They';

            async function saveReflection() {
              setSavingReflection(true);
              try {
                await api.put(`/sessions/${session.id}`, {
                  [reflectionField]: reflectionDraft.trim(),
                });
                setEditingReflection(false);
                onUpdate?.();
              } finally {
                setSavingReflection(false);
              }
            }

            if (editingReflection) {
              return (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Your reflection (private)</p>
                  <p className="text-xs text-gray-600 mb-1">{reflectionPrompt}</p>
                  <textarea
                    className="input resize-none text-sm"
                    rows={3}
                    value={reflectionDraft}
                    onChange={e => setReflectionDraft(e.target.value)}
                    placeholder="Take a moment to put words to what you took away…"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveReflection}
                      disabled={savingReflection || !reflectionDraft.trim()}
                      className="btn-primary text-sm"
                    >
                      {savingReflection ? 'Saving…' : 'Save reflection'}
                    </button>
                    <button
                      onClick={() => { setEditingReflection(false); setReflectionDraft(''); }}
                      className="btn-ghost text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            if (myReflection) {
              return (
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Your reflection (private)</p>
                    <button
                      onClick={() => { setReflectionDraft(myReflection); setEditingReflection(true); }}
                      className="text-xs text-navy-light hover:text-navy font-medium"
                    >
                      Edit
                    </button>
                  </div>
                  <p className="text-gray-700 whitespace-pre-wrap">{myReflection}</p>
                </div>
              );
            }

            return (
              <div>
                <p className="text-gray-400 text-xs italic mb-2">
                  You haven't written a reflection for this one. {partnerName}'s reflection (if any) is private to them.
                </p>
                <button
                  onClick={() => { setReflectionDraft(''); setEditingReflection(true); }}
                  className="btn-secondary text-xs"
                >
                  + Add a reflection
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
function pastRelative(date) {
  const ms = Date.now() - date.getTime();
  if (ms < 0) return null;
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'} ago`;
  return null;
}
function upcomingRelative(date) {
  const ms = date.getTime() - Date.now();
  if (ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return minutes <= 1 ? 'in <1 min' : `in ${minutes} min`;
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  if (days < 30) return `in ${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'}`;
  return null;
}
