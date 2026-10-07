import React, { useState } from 'react';
import api from '../api/index.js';
import { useT } from '../i18n/index.jsx';
import { Button } from './ui/button.jsx';

function RecoveryScreen({ errorName }) {
  const { t } = useT();
  const [reportState, setReportState] = useState('idle');
  async function report() {
    setReportState('sending');
    try {
      const area = window.location.pathname.split('/').filter(Boolean)[0] || 'home';
      await api.post('/feedback', { category: 'bug', message: `Client render error: ${errorName}; area: ${area}` });
      setReportState('sent');
    } catch {
      setReportState('failed');
    }
  }
  return <main className="grid min-h-screen place-items-center bg-background p-6">
    <div role="alert" className="max-w-md rounded-2xl bg-card p-8 text-center">
      <h1 className="text-xl font-semibold">{t('components.appError.title')}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t('components.appError.description')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => window.location.reload()}>{t('components.appError.reload')}</Button>
        {reportState !== 'sent' && <Button variant="outline" disabled={reportState === 'sending'} onClick={report}>{t('components.appError.report')}</Button>}
      </div>
      {reportState === 'sent' && <p className="mt-3 text-sm" role="status">{t('components.appError.reported')}</p>}
      {reportState === 'failed' && <p className="mt-3 text-sm text-destructive" role="alert">{t('components.appError.reportFailed')}</p>}
    </div>
  </main>;
}

export default class AppErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <RecoveryScreen errorName={this.state.errorName || 'Error'} /> : this.props.children;
  }

  componentDidCatch(error) {
    this.setState({ errorName: error?.name || 'Error' });
  }
}
