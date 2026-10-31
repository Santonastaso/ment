import { errorMessage } from '../lib/errors.mjs';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Pencil } from 'lucide-react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { canCompleteMeeting, meetingFeedback } from '../lib/conversations.mjs';
import RatingPicker from './RatingPicker.jsx';
import { Button } from './ui/button.jsx';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog.jsx';

export default function MeetingFeedback({ session, onSaved, compact = false }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reflection, setReflection] = useState('');
  const [rating, setRating] = useState(null);
  const [benefit, setBenefit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Right after a meeting is marked complete is when its lessons are fresh:
  // offer the check-in that turns them into skills.
  const [offerCheckIn, setOfferCheckIn] = useState(false);
  const navigate = useNavigate();
  const completed = session.viewer_completed || session.status === 'completed';
  if (!completed && !canCompleteMeeting(session) && !offerCheckIn) return null;

  function edit() {
    setReflection((session.isMentor ? session.mentor_reflection : session.reflection) || '');
    setRating((session.isMentor ? session.mentor_rating : session.mentee_rating) ?? null);
    setBenefit(null);
    setError('');
    setOfferCheckIn(false);
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api.put(`/sessions/${session.id}`, meetingFeedback(session, reflection, rating));
      // The student's answer to "did it help?" feeds the school's impact figure; optional.
      if (!session.isMentor && benefit) await api.post(`/sessions/${session.id}/benefit`, { answer: benefit });
      const firstCompletion = !completed;
      await onSaved();
      if (firstCompletion) setOfferCheckIn(true); else setOpen(false);
    } catch (err) {
      setError(errorMessage(err, t, t('conversations.error')));
    } finally { setSaving(false); }
  }

  const actionLabel = t(completed ? 'components.meeting.edit' : 'components.session.markCompleted');

  return <>
    <Button size={compact ? 'icon-sm' : 'sm'} variant={compact ? 'ghost' : 'outline'} className={compact ? 'conversation-icon-action' : undefined} onClick={edit} aria-label={compact ? actionLabel : undefined} title={compact ? actionLabel : undefined}>
      {compact && (completed ? <Pencil aria-hidden="true" /> : <Check aria-hidden="true" />)}
      {!compact && actionLabel}
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
      <DialogContent>
        {offerCheckIn ? <>
          <DialogTitle>{t('components.meeting.checkInPromptTitle')}</DialogTitle>
          <DialogDescription>{t('components.meeting.checkInPromptBody')}</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('components.meeting.checkInLater')}</Button>
            <Button type="button" onClick={() => navigate('/profile?tab=reflections&checkin=1')}>{t('components.reflection.startCheckIn')}</Button>
          </div>
        </> : <>
        <DialogTitle>{t(completed ? 'components.meeting.yourReflectionPrivate' : 'components.session.markCompleted')}</DialogTitle>
        <DialogDescription>{t(session.isMentor ? 'components.meeting.reflectionPromptMentor' : 'components.meeting.reflectionPromptMentee')}</DialogDescription>
        <form onSubmit={save} className="space-y-4">
          <label className="grid gap-2">
            <span>{t('components.meeting.yourReflectionPrivate')}</span>
            <textarea className="input min-h-24" maxLength={4000} value={reflection} onChange={event => setReflection(event.target.value)} disabled={saving} />
          </label>
          <div className="grid gap-2"><span>{t('components.meeting.yourRatingPrivate')}</span><RatingPicker value={rating} onChange={setRating} disabled={saving} /></div>
          {!session.isMentor && (
            <fieldset className="grid gap-2" data-testid="meeting-benefit">
              <legend className="mb-1">{t('components.meeting.benefitQuestion')}</legend>
              <div className="flex flex-wrap gap-2">
                {['yes', 'somewhat', 'no'].map(answer => (
                  <Button key={answer} type="button" size="sm" variant={benefit === answer ? 'default' : 'outline'} aria-pressed={benefit === answer}
                    disabled={saving} onClick={() => setBenefit(current => (current === answer ? null : answer))}>
                    {t(`components.meeting.benefit.${answer}`)}
                  </Button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{t('components.meeting.benefitHelp')}</span>
            </fieldset>
          )}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={saving}>{t(saving ? 'components.meeting.saving' : 'common.save')}</Button>
          </div>
        </form>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
