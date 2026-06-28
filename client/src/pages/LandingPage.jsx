import React from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Public landing page shown to non-authenticated visitors.
//
// Content is intentionally a clean skeleton — Fra + Pit will swap in finalised
// marketing copy once the slides are ready. Strings live in i18n catalogs
// (locales/<lang>/landing.json) so translation stays in lockstep.
function NavBar({ t }) {
  return (
    <header className="border-b border-[var(--border)] bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link to="/welcome" className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">M</span>
          <span className="text-lg font-semibold tracking-tight">MENT</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost" size="sm">{t('landing.nav.signIn')}</Button>
          </Link>
          <Link to="/request-access">
            <Button size="sm">{t('landing.nav.bookDemo')}</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero({ t }) {
  return (
    <section className="border-b border-[var(--border)] bg-gradient-to-b from-background to-muted/40">
      <div className="mx-auto max-w-6xl px-4 py-20 text-center">
        <p className="mb-4 inline-block rounded-full border border-[var(--border)] bg-background px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground">
          {t('landing.hero.eyebrow')}
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          {t('landing.hero.title')}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
          {t('landing.hero.subtitle')}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/request-access">
            <Button size="lg">{t('landing.hero.ctaPrimary')}</Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="outline">{t('landing.hero.ctaSecondary')}</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ title, description }) {
  return (
    <Card className="rounded-xl border-[var(--border)] shadow-none">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function Products({ t }) {
  return (
    <section className="border-b border-[var(--border)] bg-background">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">{t('landing.products.title')}</h2>
          <p className="mt-2 text-muted-foreground">{t('landing.products.subtitle')}</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Card className="rounded-xl border-[var(--border)] shadow-none">
            <CardHeader>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">
                {t('landing.products.intraEyebrow')}
              </p>
              <CardTitle className="text-xl">{t('landing.products.intraTitle')}</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                {t('landing.products.intraDescription')}
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="rounded-xl border-[var(--border)] shadow-none">
            <CardHeader>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">
                {t('landing.products.interEyebrow')}
              </p>
              <CardTitle className="text-xl">{t('landing.products.interTitle')}</CardTitle>
              <CardDescription className="text-sm leading-relaxed">
                {t('landing.products.interDescription')}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </section>
  );
}

function HowItWorks({ t }) {
  const steps = [
    { title: t('landing.how.step1Title'), description: t('landing.how.step1Description') },
    { title: t('landing.how.step2Title'), description: t('landing.how.step2Description') },
    { title: t('landing.how.step3Title'), description: t('landing.how.step3Description') },
  ];
  return (
    <section className="border-b border-[var(--border)] bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">{t('landing.how.title')}</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {steps.map((step, idx) => (
            <div key={idx} className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-background p-6">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {idx + 1}
              </div>
              <h3 className="text-base font-semibold">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Trust({ t }) {
  const points = [
    t('landing.trust.point1'),
    t('landing.trust.point2'),
    t('landing.trust.point3'),
    t('landing.trust.point4'),
  ];
  return (
    <section className="border-b border-[var(--border)] bg-background">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t('landing.trust.title')}</h2>
            <p className="mt-2 text-muted-foreground">{t('landing.trust.subtitle')}</p>
          </div>
          <ul className="space-y-3">
            {points.map((point, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <span className="mt-1.5 flex size-2 shrink-0 rounded-full bg-primary" />
                <span className="text-sm text-foreground">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FinalCta({ t }) {
  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">{t('landing.finalCta.title')}</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{t('landing.finalCta.subtitle')}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/request-access">
            <Button size="lg">{t('landing.finalCta.ctaPrimary')}</Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="outline">{t('landing.finalCta.ctaSecondary')}</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer({ t }) {
  return (
    <footer className="border-t border-[var(--border)] bg-muted/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">M</span>
          <span>{t('landing.footer.copyright')}</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link to="/login" className="hover:text-foreground">{t('landing.nav.signIn')}</Link>
          <Link to="/request-access" className="hover:text-foreground">{t('landing.nav.bookDemo')}</Link>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  const { t } = useT();
  return (
    <div className="min-h-screen bg-background">
      <NavBar t={t} />
      <main>
        <Hero t={t} />
        <Products t={t} />
        <HowItWorks t={t} />
        <Trust t={t} />
        <FinalCta t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}
