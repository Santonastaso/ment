import React from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.jsx';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  const { t } = useT();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <p className="text-sm font-semibold tracking-[0.16em] text-primary">404</p>
      <h1 className="mt-3 text-display font-semibold">{t('common.notFound.title')}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">{t('common.notFound.description')}</p>
      <Link to="/welcome" className="mt-6"><Button>{t('common.notFound.back')}</Button></Link>
    </main>
  );
}
