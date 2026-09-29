import PageHeader from './PageHeader.jsx';
import { cn } from '@/lib/utils';

/** Standard page wrapper — full width of the main column, consistent vertical rhythm. */
export function PageShell({ title, description, action, children, className, compact, hideTitle }) {
  const hasVisibleHeader = (!hideTitle && title) || description || action;
  return (
    <div className={cn('flex w-full flex-col gap-5', className)}>
      {hideTitle && title && !hasVisibleHeader && <h1 className="sr-only">{title}</h1>}
      {hasVisibleHeader && (
        <PageHeader title={title} description={description} action={action} compact={compact} hideTitle={hideTitle} />
      )}
      {children}
    </div>
  );
}

/** In-page section (below the page header): title row + content. */
export function PageSection({ title, description, action, children, className }) {
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      {(title || description || action) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold tracking-[-0.015em] text-foreground">{title}</h2>}
            {description && (
              <div className="mt-1 text-sm text-muted-foreground">{description}</div>
            )}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
