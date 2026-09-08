import React from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.jsx';
import { Button } from '@/components/ui/button';

function Brand() {
  return (
    <Link to="/welcome" className="flex items-center gap-2.5" aria-label="Ment home">
      <span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">M</span>
      <span className="text-[15px] font-semibold tracking-[-0.01em]">MENT</span>
    </Link>
  );
}

function NavBar({ t }) {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-6">
        <Brand />
        <nav className="flex items-center gap-1.5" aria-label="Account">
          <Link to="/request-access">
            <Button variant="ghost" size="sm">{t('landing.nav.bookDemo')}</Button>
          </Link>
          <Link to="/login">
            <Button size="sm">{t('landing.nav.signIn')}</Button>
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
    <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-[18px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">M</span>
          <span className="text-sm font-semibold">Ment</span>
        </div>
        <span className="text-xs text-muted-foreground">{t('landing.preview.network')}</span>
      </div>
      <div className="px-4 py-5 sm:px-5">
        <p className="ml-auto w-fit max-w-[90%] rounded-[16px_16px_5px_16px] bg-muted px-4 py-2.5 text-sm leading-5">
          {t('landing.preview.query')}
        </p>
        <div className="mt-5 flex max-w-2xl items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">M</span>
          <div>
            <p className="text-sm font-medium">{t('landing.preview.intro')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('landing.preview.reason')}</p>
          </div>
        </div>
      </div>
      <div>{MATCHES.map(match => <MatchRow key={match.name} match={match} t={t} />)}</div>
      <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/55 px-4 py-3 sm:px-5">
        <p className="text-xs text-muted-foreground">{t('landing.preview.privacy')}</p>
        <Link to="/login" className="shrink-0 text-sm font-semibold hover:underline">{t('landing.nav.signIn')}</Link>
      </div>
    </div>
  );
}

function Hero({ t }) {
  return (
    <section className="px-5 pb-14 pt-16 sm:px-6 sm:pt-20">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-medium text-primary">{t('landing.hero.eyebrow')}</p>
        <h1 className="mt-4 text-[clamp(2.25rem,6vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.045em]">
          {t('landing.hero.title')}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-[17px]">
          {t('landing.hero.subtitle')}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          <Link to="/login"><Button size="lg">{t('landing.hero.ctaPrimary')}</Button></Link>
          <Link to="/request-access"><Button size="lg" variant="outline">{t('landing.hero.ctaSecondary')}</Button></Link>
        </div>
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
    <section className="border-y border-border bg-muted/55 px-5 py-14 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-xl font-semibold tracking-[-0.02em]">{t('landing.how.title')}</h2>
        <div className="mt-5 divide-y divide-border border-y border-border">
          {steps.map(([title, description], index) => (
            <div key={title} className="grid gap-2 py-4 sm:grid-cols-[32px_190px_1fr] sm:items-baseline">
              <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing({ t }) {
  return (
    <section className="px-5 py-14 sm:px-6">
      <div className="mx-auto flex max-w-4xl flex-col justify-between gap-6 rounded-[18px] border border-border bg-card p-6 sm:flex-row sm:items-center sm:p-8">
        <div>
          <h2 className="max-w-xl text-2xl font-semibold tracking-[-0.03em]">{t('landing.finalCta.title')}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{t('landing.finalCta.subtitle')}</p>
        </div>
        <div className="flex shrink-0 gap-2.5">
          <Link to="/login"><Button size="lg">{t('landing.finalCta.ctaPrimary')}</Button></Link>
          <Link to="/request-access"><Button size="lg" variant="outline">{t('landing.finalCta.ctaSecondary')}</Button></Link>
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
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const { t } = useT();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar t={t} />
      <main>
        <Hero t={t} />
        <HowItWorks t={t} />
        <Closing t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}
