import { cn } from '@/lib/utils';

export default function PageHeader({ title, description, action, compact }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-b border-[var(--border)] sm:flex-row sm:items-start sm:justify-between',
        compact ? 'mb-2 pb-3' : 'mb-3 pb-4'
      )}
    >
      <div>
        <h1 className={cn('font-semibold tracking-[-0.01em] text-foreground', compact ? 'text-xl' : 'text-[26px]')}>
          {title}
        </h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
