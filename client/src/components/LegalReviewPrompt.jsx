import React, { useEffect, useRef, useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { CONSENT_VERSIONS } from '../lib/consent.js';
import { Button } from './ui/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Required review of the published documents. Optional AI permission is separate.
// Protected screens do not mount until the server confirms this version.
export default function LegalReviewPrompt({ userId, children }) {
  const { t } = useT();
  const { logout } = useAuth();
  const version = CONSENT_VERSIONS.terms_privacy;
  const [status, setStatus] = useState('loading');
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const checkVersion = useRef(0);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setAgreed(false);
    const check = async () => {
      const request = ++checkVersion.current;
      try {
        const { data } = await api.get('/users/me/terms-review');
        if (active && request === checkVersion.current) setStatus(data.accepted ? 'accepted' : 'missing');
      } catch { if (active && request === checkVersion.current) setStatus(current => current === 'accepted' ? current : 'error'); }
    };
    check();
    window.addEventListener('focus', check);
    return () => { active = false; window.removeEventListener('focus', check); };
  }, [userId, version, retry]);

  async function accept() {
    if (!agreed || saving) return;
    setSaving(true); setError(false);
    try {
      await api.post('/users/me/consents', { purpose: 'terms_privacy' });
      checkVersion.current += 1;
      setStatus('accepted');
    } catch { setError(true); }
    finally { setSaving(false); }
  }

  if (status === 'accepted') return children;
  if (status === 'loading') return <div className="flex min-h-screen items-center justify-center bg-background"><p role="status" className="text-sm text-muted-foreground">{t('legalReview.checking')}</p></div>;
  return <div className="min-h-screen bg-background"><Dialog open>
    <DialogContent showCloseButton={false} data-testid="legal-review-prompt">
      <DialogHeader>
        <DialogTitle>{t('legalReview.title')}</DialogTitle>
        <DialogDescription>{t('legalReview.description')}</DialogDescription>
      </DialogHeader>
      <div className="flex gap-4 text-sm">
        <a className="underline underline-offset-4" href="/terms" target="_blank" rel="noreferrer">{t('legal.terms.title')}</a>
        <a className="underline underline-offset-4" href="/privacy" target="_blank" rel="noreferrer">{t('legal.privacy.title')}</a>
      </div>
      <p className="text-xs text-muted-foreground">{t('legalReview.version', { version })}</p>
      {status === 'missing' && <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={agreed} onChange={event => setAgreed(event.target.checked)} disabled={saving} />
        <span>{t('legalReview.agreement')}</span>
      </label>}
      {(error || status === 'error') && <p role="alert" className="text-sm text-destructive">{t('legalReview.error')}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={logout} disabled={saving}>{t('legalReview.signOut')}</Button>
        {status === 'error' ? <Button onClick={() => setRetry(value => value + 1)}>{t('legalReview.retry')}</Button>
          : <Button onClick={accept} disabled={!agreed || saving}>{t(saving ? 'legalReview.saving' : 'legalReview.accept')}</Button>}
      </div>
    </DialogContent>
  </Dialog></div>;
}
