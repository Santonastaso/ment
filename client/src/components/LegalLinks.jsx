import { Link } from 'react-router-dom';

export default function LegalLinks({ className = '' }) {
  return <div className={`flex items-center justify-center gap-4 text-xs text-muted-foreground ${className}`}><Link to="/terms" className="hover:text-foreground">Terms</Link><Link to="/privacy" className="hover:text-foreground">Privacy</Link></div>;
}
