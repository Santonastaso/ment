import { cn } from '@/lib/utils';

export default function PageHeader({ title, description, action, hideTitle = false, as: Heading = 'h1' }) {
  return (
    <div
      className={cn(
        'page-title-row flex min-h-[var(--workspace-top-row)] items-center justify-between gap-3',
        description && 'py-3'
      )}
    >
      <div className="min-w-0">
        <Heading className={cn(hideTitle ? 'sr-only' : 'text-title font-semibold tracking-[-0.02em]')}>
          {title}
        </Heading>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
