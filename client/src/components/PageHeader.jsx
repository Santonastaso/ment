import { cn } from '@/lib/utils';

export default function PageHeader({ title, description, action, compact, hideTitle = false }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        compact ? 'mb-0.5' : 'mb-1'
      )}
    >
      <div>
        <h1 className={cn(hideTitle ? 'sr-only' : 'font-semibold tracking-[-0.025em] text-foreground', !hideTitle && (compact ? 'text-xl' : 'text-2xl'))}>
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
