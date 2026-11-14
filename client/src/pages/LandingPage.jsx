import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.jsx';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LanguageSwitcher from '../i18n/LanguageSwitcher.jsx';

const prefersReducedMotion = () =>
  typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Marks every .reveal element in the page as visible once it scrolls into
// view; CSS does the fade and lift. Without IntersectionObserver, or with
// reduced motion, everything is shown at once.
function useReveal(rootRef) {
  useEffect(() => {
    const items = rootRef.current?.querySelectorAll('.reveal') ?? [];
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      items.forEach(item => item.classList.add('is-visible'));
      return undefined;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    items.forEach(item => observer.observe(item));
    return () => observer.disconnect();
  }, [rootRef]);
}

// Counts the number inside a translated figure ("87%", "87 %") up from zero
// the first time it is on screen, keeping the text around it.
function CountUp({ value }) {
  const ref = useRef(null);
  const digits = value.match(/\d+/)?.[0];
  const target = digits ? Number(digits) : 0;
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));

  useEffect(() => {
    if (!digits || prefersReducedMotion() || !('IntersectionObserver' in window)) {
      setShown(target);
      return undefined;
    }
    let frame;
    let settle;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const tick = now => {
        const progress = Math.min((now - start) / 1200, 1);
        setShown(Math.round(target * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      // Frames can be throttled (background tab, slow device); land on the
      // real figure regardless.
      settle = setTimeout(() => { cancelAnimationFrame(frame); setShown(target); }, 1600);
    }, { threshold: 0.4 });
    observer.observe(ref.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(settle); };
  }, [digits, target]);

  return <strong ref={ref} aria-label={value}>{digits ? value.replace(digits, String(shown)) : value}</strong>;
}

function Brand() {
  return (
    <Link to="/welcome" className="flex items-center gap-2.5" aria-label="Ment home">
      <span className="landing-wordmark">ment<span>.</span></span>
    </Link>
  );
}

function NavBar({ t }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`landing-nav border-b ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5 sm:px-6">
        <Brand />
        <nav className="flex items-center gap-1.5" aria-label="Account">
          <LanguageSwitcher className="mr-1.5" />
          <Link to="/login">
            <Button size="sm">{t('landing.nav.signIn')}</Button>
          </Link>
          <Link to="/request-access" className="hidden sm:block">
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

function MatchRow({ match, index, t }) {
  return (
    <div className={`landing-stage landing-stage-${3 + index} grid gap-4 border-t border-border px-4 py-4 sm:grid-cols-[1fr_1.25fr_auto] sm:items-center sm:px-5`}>
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
          <span className="grid size-7 place-items-center rounded-full bg-primary text-micro font-bold text-[var(--coral)]">M</span>
          <span className="text-sm font-semibold">Ment</span>
        </div>
        <span className="text-xs text-muted-foreground">{t('landing.preview.network')}</span>
      </div>
      <div className="px-4 py-5 sm:px-5">
        <p className="landing-stage landing-stage-1 ml-auto w-fit max-w-[90%] rounded-[16px_16px_5px_16px] bg-muted px-4 py-2.5 text-sm leading-5">
          {t('landing.preview.query')}
        </p>
        <div className="landing-stage landing-stage-2 mt-5 flex max-w-2xl items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-micro font-bold text-[var(--coral)]">M</span>
          <div>
            <p className="text-sm font-medium">{t('landing.preview.intro')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('landing.preview.reason')}</p>
          </div>
        </div>
      </div>
      <div>{MATCHES.map((match, index) => <MatchRow key={match.name} match={match} index={index} t={t} />)}</div>
      <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/55 px-4 py-3 sm:px-5">
        <p className="text-xs text-muted-foreground">{t('landing.preview.privacy')}</p>
      </div>
    </div>
  );
}

function Hero({ t }) {
  return (
    <section className="landing-hero">
      <div className="landing-hero-copy landing-hero-enter">
        <h1>
          {t('landing.hero.title')}
        </h1>
        <p className="landing-hero-subtitle">{t('landing.hero.subtitle')}</p>
        <div className="landing-hero-actions">
          <Link to="/request-access"><Button>{t('landing.nav.bookDemo')}</Button></Link>
          <Link to="/login"><Button variant="outline">{t('landing.nav.signIn')}</Button></Link>
        </div>
      </div>
      <ProductConversation t={t} />
    </section>
  );
}

// One translated sentence with its figure counting up in place of {value}.
function FigureSentence({ text, value, delay }) {
  const [before, after = ''] = text.split('{value}');
  return (
    <span className="landing-problem-line reveal" style={{ '--reveal-delay': delay }}>
      {before}<CountUp value={value} />{after}{' '}
    </span>
  );
}

function Problem({ t }) {
  return (
    <section className="landing-problem">
      <div className="landing-section-inner">
        <p className="landing-problem-text">
          <FigureSentence text={t('landing.problem.line1')} value={t('landing.problem.stat1.value')} delay="0ms" />
          <FigureSentence text={t('landing.problem.line2')} value={t('landing.problem.stat2.value')} delay="150ms" />
          <FigureSentence text={t('landing.problem.line3')} value={t('landing.problem.stat3.value')} delay="300ms" />
        </p>
        <div className="landing-problem-foot reveal">
          <p>{t('landing.problem.close')}</p>
          <small>{t('landing.problem.source')}</small>
        </div>
      </div>
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
        <h2 className="reveal">{t('landing.how.title')}</h2>
        <div className="landing-how-steps">
          {steps.map(([title, description], index) => (
            <div key={title} className="landing-how-step reveal" style={{ '--reveal-delay': `${index * 100}ms` }}>
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

function Audiences({ t }) {
  const groups = [
    [t('landing.audiences.students.title'), t('landing.audiences.students.body')],
    [t('landing.audiences.alumni.title'), t('landing.audiences.alumni.body')],
    [t('landing.audiences.schools.title'), t('landing.audiences.schools.body')],
  ];
  return (
    <section className="landing-section">
      <div className="landing-section-inner">
        <h2 className="reveal">{t('landing.audiences.title')}</h2>
        <div className="landing-audiences">
          {groups.map(([title, body], index) => (
            <div key={title} className="reveal" style={{ '--reveal-delay': `${index * 100}ms` }}>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// A working copy of the alumni availability controls from Profile, so a
// visitor can feel how little it takes. Nothing is saved.
function AlumniControls({ t }) {
  const [open, setOpen] = useState(true);
  const [limit, setLimit] = useState(2);
  return (
    <div className="landing-demo reveal" style={{ '--reveal-delay': '150ms' }}>
      <p className="landing-demo-caption">{t('landing.control.demo.caption')}</p>
      <div className="landing-demo-card">
        <div className="landing-demo-row">
          <p aria-live="polite">{open ? t('landing.control.demo.available') : t('landing.control.demo.paused')}</p>
          <button
            type="button"
            role="switch"
            className="availability-switch"
            aria-checked={open}
            aria-label={open ? t('landing.control.demo.pause') : t('landing.control.demo.resume')}
            onClick={() => setOpen(value => !value)}
          />
        </div>
        <div className={`landing-demo-row ${open ? '' : 'is-muted'}`}>
          <p>{t('landing.control.demo.limit')}</p>
          <div className="landing-demo-stepper">
            <button type="button" aria-label={t('landing.control.demo.decrease')} disabled={!open || limit <= 1} onClick={() => setLimit(value => value - 1)}><Minus aria-hidden="true" /></button>
            <output aria-live="polite">{limit}</output>
            <button type="button" aria-label={t('landing.control.demo.increase')} disabled={!open || limit >= 8} onClick={() => setLimit(value => value + 1)}><Plus aria-hidden="true" /></button>
          </div>
        </div>
        <div className="landing-demo-slots" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => <span key={index} className={open && index < limit ? 'is-on' : ''} />)}
        </div>
      </div>
      <p className="landing-demo-hint">{t('landing.control.demo.hint')}</p>
    </div>
  );
}

function Control({ t }) {
  return (
    <section className="landing-section landing-control">
      <div className="landing-section-inner landing-control-inner">
        <div className="reveal">
          <h2>{t('landing.control.title')}</h2>
          <p className="landing-control-body">{t('landing.control.body')}</p>
          <ul className="landing-control-points">
            <li>{t('landing.control.point1')}</li>
            <li>{t('landing.control.point2')}</li>
            <li>{t('landing.control.point3')}</li>
          </ul>
        </div>
        <AlumniControls t={t} />
      </div>
    </section>
  );
}

function FinalCta({ t }) {
  return (
    <section className="landing-final">
      <div className="landing-section-inner landing-final-inner reveal">
        <h2>{t('landing.finalCta.title')}</h2>
        <div>
          <p>{t('landing.finalCta.body')}</p>
          <Link to="/request-access"><Button>{t('landing.nav.bookDemo')}</Button></Link>
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
  const shellRef = useRef(null);
  useReveal(shellRef);
  return (
    <div ref={shellRef} className="landing-shell min-h-screen text-foreground">
      <NavBar t={t} />
      <main>
        <Hero t={t} />
        <Problem t={t} />
        <HowItWorks t={t} />
        <Audiences t={t} />
        <Control t={t} />
        <FinalCta t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}
