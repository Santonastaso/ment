import PageHeader from './PageHeader.jsx';
import { cn } from '@/lib/utils';

/** Standard page wrapper — full width of the main column, consistent vertical rhythm. */
export function PageShell({ title, description, action, children, className }) {
  return (
    <div className={cn('flex w-full flex-col gap-6', className)}>
      {(title || description || action) && (
        <PageHeader title={title} description={description} action={action} />
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
            {title && <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>}
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
