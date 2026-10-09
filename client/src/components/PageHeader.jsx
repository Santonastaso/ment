import { cn } from '@/lib/utils';

export default function PageHeader({ title, description, action, compact, hideTitle = false }) {
  return (
    <div
      className={cn(
        'flex min-h-[var(--workspace-top-row)] flex-col justify-center gap-3 sm:flex-row sm:items-center sm:justify-between',
        compact ? 'mb-0.5' : 'mb-1'
      )}
    >
      <div>
        <h1 className={cn(hideTitle ? 'sr-only' : 'text-title font-semibold tracking-[-0.02em] text-foreground')}>
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
