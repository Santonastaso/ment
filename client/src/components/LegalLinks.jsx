import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.jsx';

export default function LegalLinks({ className = '' }) {
  const { t } = useT();
  return <div className={`flex items-center justify-center gap-4 text-xs text-muted-foreground ${className}`}><Link to="/terms" className="hover:text-foreground">{t('common.terms')}</Link><Link to="/privacy" className="hover:text-foreground">{t('common.privacy')}</Link></div>;
}
