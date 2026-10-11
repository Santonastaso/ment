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
