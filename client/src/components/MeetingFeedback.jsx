import React, { useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { canCompleteMeeting, meetingFeedback } from '../lib/conversations.mjs';
import RatingPicker from './RatingPicker.jsx';
import { Button } from './ui/button.jsx';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog.jsx';

export default function MeetingFeedback({ session, onSaved }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reflection, setReflection] = useState('');
  const [rating, setRating] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const completed = session.viewer_completed || session.status === 'completed';
  if (!completed && !canCompleteMeeting(session)) return null;

  function edit() {
    setReflection((session.isMentor ? session.mentor_reflection : session.reflection) || '');
    setRating((session.isMentor ? session.mentor_rating : session.mentee_rating) ?? null);
    setError('');
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api.put(`/sessions/${session.id}`, meetingFeedback(session, reflection, rating));
      await onSaved();
      setOpen(false);
    } catch (err) {
      setError(err.response?.data?.error || t('conversations.error'));
    } finally { setSaving(false); }
  }

  return <>
    <Button size="sm" variant="outline" onClick={edit}>{t(completed ? 'components.meeting.edit' : 'components.session.markCompleted')}</Button>
    <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
      <DialogContent>
        <DialogTitle>{t(completed ? 'components.meeting.yourReflectionPrivate' : 'components.session.markCompleted')}</DialogTitle>
        <DialogDescription>{t(session.isMentor ? 'components.meeting.reflectionPromptMentor' : 'components.meeting.reflectionPromptMentee')}</DialogDescription>
        <form onSubmit={save} className="space-y-4">
          <label className="grid gap-2">
            <span>{t('components.meeting.yourReflectionPrivate')}</span>
            <textarea className="min-h-24 rounded-lg border p-3" maxLength={4000} value={reflection} onChange={event => setReflection(event.target.value)} disabled={saving} />
          </label>
          <div className="grid gap-2"><span>{t('components.meeting.yourRatingPrivate')}</span><RatingPicker value={rating} onChange={setRating} disabled={saving} /></div>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={saving}>{t(saving ? 'components.meeting.saving' : 'common.save')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
