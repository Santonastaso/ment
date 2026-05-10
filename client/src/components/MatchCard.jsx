import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import SessionRequestModal from './SessionRequestModal.jsx';
import api from '../api/index.js';

export default function MatchCard({ match, onDismiss }) {
  const { user, score, reasons } = match;
  const [showModal, setShowModal] = useState(false);
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

  return (
    <>
      <div className="card p-5 flex flex-col gap-4 hover:shadow-md transition-shadow">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-navy-light flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
            {user.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <Link to={`/profile/${user.id}`} className="font-semibold text-navy hover:underline">
              {user.name}
            </Link>
            <p className="text-sm text-gray-500">{user.current_role} · {user.department}</p>
          </div>
        </div>

        <ul className="space-y-1.5">
          {(reasons || []).slice(0, 3).map((reason, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
              <span className="text-navy-light mt-0.5 flex-shrink-0">✦</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>

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
