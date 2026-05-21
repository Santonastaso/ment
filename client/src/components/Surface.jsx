import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function Surface({ className, children, ...props }) {
  return (
    <Card className={cn('rounded-xl border border-[var(--border)] bg-card shadow-none', className)} {...props}>
      {children}
    </Card>
  );
}

export function SurfaceHeader({ title, description, action, className }) {
  return (
    <CardHeader
      className={cn(
        'flex flex-row items-start justify-between space-y-0 border-b border-[var(--border)] px-6 pb-4 pt-6',
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        {title && <CardTitle className="text-base font-semibold leading-snug">{title}</CardTitle>}
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      {action ? <div className="shrink-0 pl-4">{action}</div> : null}
    </CardHeader>
  );
}

export function SurfaceBody({ className, children }) {
  return <CardContent className={cn('px-6 pb-6 pt-6', className)}>{children}</CardContent>;
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
