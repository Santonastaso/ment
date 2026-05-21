import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import AffinityIndicator from './AffinityIndicator.jsx';
import SessionRequestModal from './SessionRequestModal.jsx';
import { Surface, SurfaceBody } from './Surface.jsx';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import api from '../api/index.js';

export default function MatchCard({ match, onDismiss }) {
  const { user, score, reasons } = match;
  const [showModal, setShowModal] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  async function handleNotInterested() {
    await api.post('/connections', { addressee_id: user.id, status: 'declined' }).catch(() => {});
    setDismissed(true);
    onDismiss?.(user.id);
  }

  if (dismissed) return null;

  const hasReasons = Array.isArray(reasons) && reasons.length > 0;
  const initials = (user?.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      <Surface className="transition-colors hover:border-primary/30">
        <SurfaceBody className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Avatar className="size-10">
              <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <Link to={`/profile/${user.id}`} className="text-[15px] font-semibold text-foreground hover:text-primary hover:underline">
                {user?.name || 'Unknown'}
              </Link>
              <p className="truncate text-[13px] text-muted-foreground">{user.current_role} · {user.department}</p>
              <div className="mt-1.5">
                <AffinityIndicator score={score} />
              </div>
            </div>
          </div>

          {hasReasons && (
            <div>
              <button
                type="button"
                onClick={() => setShowDetails(v => !v)}
                className="text-[13px] font-medium text-muted-foreground hover:text-primary"
                aria-expanded={showDetails}
              >
                {showDetails ? 'Hide details' : 'Why this match?'}
              </button>
              {showDetails && (
                <ul className="mt-2 space-y-1.5">
                  {reasons.slice(0, 3).map((reason, i) => (
                    <li key={i} className="text-[13px] leading-relaxed text-muted-foreground">{reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={() => setShowModal(true)} className="flex-1">Request a session</Button>
            <Button variant="ghost" onClick={handleNotInterested} title="Remove from suggestions">Dismiss</Button>
          </div>
        </SurfaceBody>
      </Surface>

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
