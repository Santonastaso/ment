import { useState } from 'react';
import { Button } from './button.jsx';
import { Dialog, DialogContent, DialogTitle } from './dialog.jsx';
import { useT } from '../../i18n/index.jsx';

/**
 * The app's own "are you sure?", in place of the browser's confirm box.
 * const [confirm, confirmDialog] = useConfirm(); render {confirmDialog};
 * `await confirm(message)` resolves true or false.
 */
export function useConfirm() {
  const { t } = useT();
  const [ask, setAsk] = useState(null);
  const answer = value => { ask?.resolve(value); setAsk(null); };
  const confirm = message => new Promise(resolve => setAsk({ message, resolve }));
  const dialog = (
    <Dialog open={!!ask} onOpenChange={open => { if (!open) answer(false); }}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{ask?.message}</DialogTitle>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => answer(false)}>{t('common.cancel')}</Button>
          <Button type="button" variant="danger" onClick={() => answer(true)}>{t('common.confirm')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
  return [confirm, dialog];
}
