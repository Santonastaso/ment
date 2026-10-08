import React from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.jsx';
import { Button } from '@/components/ui/button';

function Brand() {
  return (
    <Link to="/welcome" className="flex items-center gap-2.5" aria-label="Ment home">
      <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">M</span>
      <span className="text-body-large font-semibold tracking-[-0.01em]">MENT</span>
    </Link>
  );
}

function NavBar({ t }) {
  return (
    <header className="landing-nav border-b border-border bg-transparent">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-6">
        <Brand />
        <nav className="flex items-center gap-1.5" aria-label="Account">
          <Link to="/login">
            <Button size="sm">{t('landing.nav.signIn')}</Button>
          </Link>
          <Link to="/request-access">
            <Button variant="outline" size="sm">{t('landing.nav.bookDemo')}</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

const MATCHES = [
  {
    initials: 'SO',
    name: 'Sam Okafor',
    role: 'Investment Associate',
    expertise: 'LBO modelling · Due diligence',
    context: 'Private Equity · London',
  },
  {
    initials: 'MW',
    name: 'Mia White',
    role: 'Vice President',
    expertise: 'Deal execution · Investment memos',
    context: 'Private Equity · Milan',
  },
];

function MatchRow({ match, t }) {
  return (
    <div className="grid gap-4 border-t border-border px-4 py-4 sm:grid-cols-[1fr_1.25fr_auto] sm:items-center sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {match.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{match.name}</p>
          <p className="truncate text-xs text-muted-foreground">{match.role}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs leading-5">
        <div>
          <p className="text-muted-foreground">{t('landing.preview.expertIn')}</p>
          <p>{match.expertise}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t('landing.preview.background')}</p>
          <p>{match.context}</p>
        </div>
      </div>
      <Link to="/login" className="text-sm font-semibold text-primary hover:underline">{t('landing.preview.view')}</Link>
    </div>
  );
}

function ProductConversation({ t }) {
  return (
    <div className="landing-preview overflow-hidden border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-full bg-primary text-micro font-bold text-primary-foreground">M</span>
          <span className="text-sm font-semibold">Ment</span>
        </div>
        <span className="text-xs text-muted-foreground">{t('landing.preview.network')}</span>
      </div>
      <div className="px-4 py-5 sm:px-5">
        <p className="ml-auto w-fit max-w-[90%] rounded-[16px_16px_5px_16px] bg-muted px-4 py-2.5 text-sm leading-5">
          {t('landing.preview.query')}
        </p>
        <div className="mt-5 flex max-w-2xl items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-micro font-bold text-primary-foreground">M</span>
          <div>
            <p className="text-sm font-medium">{t('landing.preview.intro')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('landing.preview.reason')}</p>
          </div>
        </div>
      </div>
      <div>{MATCHES.map(match => <MatchRow key={match.name} match={match} t={t} />)}</div>
      <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/55 px-4 py-3 sm:px-5">
        <p className="text-xs text-muted-foreground">{t('landing.preview.privacy')}</p>
        <span className="landing-preview-folio">MENT / 02</span>
      </div>
    </div>
  );
}

function Hero({ t }) {
  return (
    <section className="landing-hero">
      <div className="landing-hero-copy">
        <p className="landing-hero-eyebrow">{t('landing.hero.eyebrow')}</p>
        <h1>
          {t('landing.hero.title')}
        </h1>
        <span className="landing-hero-index">MENT / 01</span>
      </div>
      <ProductConversation t={t} />
    </section>
  );
}

function HowItWorks({ t }) {
  const steps = [
    [t('landing.how.step1Title'), t('landing.how.step1Description')],
    [t('landing.how.step2Title'), t('landing.how.step2Description')],
    [t('landing.how.step3Title'), t('landing.how.step3Description')],
  ];

  return (
    <section className="landing-how">
      <div className="landing-how-inner">
        <h2>{t('landing.how.title')}</h2>
        <div className="landing-how-steps">
          {steps.map(([title, description], index) => (
            <div key={title} className="landing-how-step">
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer({ t }) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col justify-between gap-3 px-5 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
        <span>{t('landing.footer.copyright')}</span>
        <div className="flex items-center gap-4">
          <Link to="/terms" className="hover:text-foreground">{t('common.terms')}</Link>
          <Link to="/privacy" className="hover:text-foreground">{t('common.privacy')}</Link>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const { t } = useT();
  return (
    <div className="landing-shell min-h-screen text-foreground">
      <NavBar t={t} />
      <main>
        <Hero t={t} />
        <HowItWorks t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}
