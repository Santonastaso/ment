import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function Surface({ className, children, ...props }) {
  return (
    <Card className={cn('gap-0 rounded-[var(--panel-radius)] border-0 bg-[var(--surface)] py-0', className)} {...props}>
      {children}
    </Card>
  );
}

export function SurfaceHeader({ title, description, action, className }) {
  return (
    <CardHeader
      className={cn(
        'flex flex-row items-start justify-between space-y-0 bg-transparent px-4 pb-2 pt-4 sm:px-5',
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        {title && <CardTitle className="text-[16px] font-semibold leading-snug tracking-[-0.01em]">{title}</CardTitle>}
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      {action ? <div className="shrink-0 pl-4">{action}</div> : null}
    </CardHeader>
  );
}

export function SurfaceBody({ className, children }) {
  return <CardContent className={cn('px-4 pb-4 pt-3 sm:px-5 sm:pb-5', className)}>{children}</CardContent>;
}

/** Card with only a header row (metrics, toolbar). */
export function SurfacePanel({ title, description, action, children, className }) {
  return (
    <Surface className={className}>
      {(title || description || action) && (
        <SurfaceHeader title={title} description={description} action={action} />
      )}
      {children ? <SurfaceBody className={title || description || action ? 'pt-5' : undefined}>{children}</SurfaceBody> : null}
    </Surface>
  );
}
