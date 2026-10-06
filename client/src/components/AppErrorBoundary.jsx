import React from 'react';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';

function RecoveryScreen() {
  const { t } = useT();
  return <main className="grid min-h-screen place-items-center bg-background p-6">
    <div role="alert" className="max-w-md rounded-2xl bg-card p-8 text-center">
      <h1 className="text-xl font-semibold">{t('components.appError.title')}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t('components.appError.description')}</p>
      <Button className="mt-6" onClick={() => window.location.reload()}>{t('components.appError.reload')}</Button>
    </div>
  </main>;
}

export default class AppErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <RecoveryScreen /> : this.props.children;
  }
}
