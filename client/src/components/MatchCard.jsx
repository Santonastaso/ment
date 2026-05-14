import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AffinityIndicator from './AffinityIndicator.jsx';
import SessionRequestModal from './SessionRequestModal.jsx';
import api from '../api/index.js';

export default function MatchCard({ match, onDismiss }) {
  const { user, score, reasons } = match;
  const [showModal, setShowModal] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  async function handleNotInterested() {
    // Upsert connection with status='declined' in a single call. The server
    // updates the existing row if present, inserts otherwise — so this is
    // safe to call repeatedly.
    await api.post('/connections', { addressee_id: user.id, status: 'declined' }).catch(() => {});
    setDismissed(true);
    onDismiss?.(user.id);
  }

  if (dismissed) return null;

  const hasReasons = Array.isArray(reasons) && reasons.length > 0;

  return (
    <>
      <div className="card p-6 flex flex-col gap-5 transition-all hover:border-navy/20">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-full bg-navy-light flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
            {user.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <Link to={`/profile/${user.id}`} className="font-semibold text-ink hover:text-navy transition-colors">
              {user.name}
            </Link>
            <p className="text-sm text-ink-secondary truncate">{user.current_role} · {user.department}</p>
            <div className="mt-2">
              <AffinityIndicator score={score} />
            </div>
          </div>
        </div>

        {/* Details — collapsed by default, expands to show structured reasons */}
        {hasReasons && (
          <div className="-mt-1">
            <button
              type="button"
              onClick={() => setShowDetails(v => !v)}
              className="text-xs font-medium text-ink-secondary hover:text-navy inline-flex items-center gap-1 transition-colors"
              aria-expanded={showDetails}
            >
              {showDetails ? 'Hide details' : 'Why this match?'}
              <span className="text-ink-tertiary">{showDetails ? '▴' : '▾'}</span>
            </button>
            {showDetails && (
              <ul className="mt-2.5 space-y-2">
                {reasons.slice(0, 3).map((reason, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink-secondary leading-relaxed">
                    <span className="text-navy-light mt-1 flex-shrink-0">✦</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary text-sm flex-1"
          >
            Request a session
          </button>
          <button
            onClick={handleNotInterested}
            className="btn-ghost text-sm"
            title="Remove from suggestions"
          >
            Not interested
          </button>
        </div>
      </div>

      {showModal && (
        <SessionRequestModal
          mentor={user}
          onClose={() => setShowModal(false)}
          onSuccess={() => setShowModal(false)}
        />
      )}
    </>
  );
}
