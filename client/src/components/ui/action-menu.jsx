import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './button.jsx';
import { cn } from '@/lib/utils';

/** Shared, keyboard-accessible row menu. The portal avoids table scroll clipping. */
export function ActionMenu({ label, items, testId }) {
  if (!items.length) return null;

  return (
    <Menu.Root>
      <Menu.Trigger render={<Button type="button" variant="outline" size="xs" data-testid={testId} />}>
        <MoreHorizontal aria-hidden="true" />{label}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Menu.Popup className="min-w-48 rounded-2xl border border-[var(--border)] bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-overlay)] outline-none">
            {items.map(item => (
              <Menu.Item
                key={item.label}
                data-testid={item.testId}
                disabled={item.disabled}
                onClick={item.onSelect}
                className={cn(
                  'flex min-h-10 w-full cursor-pointer items-center rounded-[var(--item-radius)] px-3 text-left text-sm outline-none data-[highlighted]:bg-[var(--control-surface)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
                  item.destructive && 'text-destructive'
                )}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
