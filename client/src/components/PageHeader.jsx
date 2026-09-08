import { cn } from '@/lib/utils';

export default function PageHeader({ title, description, action, compact }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        compact ? 'mb-1 pb-1' : 'mb-2 pb-2'
      )}
    >
      <div>
        <h1 className={cn('font-semibold tracking-[-0.02em] text-foreground', compact ? 'text-xl' : 'text-[28px]')}>
          {title}
        </h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
