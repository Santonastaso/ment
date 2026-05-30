import { useT } from '../i18n/index.jsx';

export default function SuggestedPill({ source }) {
  const { t } = useT();
  if (!source) return null;
  const label = source === 'claude+esco' ? 'Claude + ESCO'
    : source === 'claude' ? 'Claude'
    : source === 'esco' ? 'ESCO'
    : t('components.suggested.heuristic');
  return (
    <span className="ml-2 text-[10px] uppercase tracking-wide font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
      AI · {label}
    </span>
  );
}
