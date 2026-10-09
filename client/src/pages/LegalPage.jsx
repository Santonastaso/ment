import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.jsx';

export default function LegalPage({ type }) {
  const { t } = useT();
  const sectionCount = type === 'privacy' ? 7 : 5;
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/welcome" className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-white">M</span><strong>MENT</strong></Link>
          <Link to="/welcome" className="text-sm text-muted-foreground hover:text-foreground">{t('legal.back')}</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('legal.effectiveDate')}</p>
        <h1 className="marketing-display mt-3 text-5xl">{t(`legal.${type}.title`)}</h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground">{t(`legal.${type}.intro`)}</p>
        <div className="mt-12 border-t border-[var(--border)]">
          {Array.from({ length: sectionCount }, (_, index) => index + 1).map(index => (
            <section key={index} className="grid gap-3 border-b border-[var(--border)] py-6 sm:grid-cols-[180px_1fr]">
              <h2 className="text-sm font-semibold">{t(`legal.${type}.${index}.title`)}</h2>
              <p className="text-sm leading-6 text-muted-foreground">{t(`legal.${type}.${index}.body`)}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
