import { Field } from './ui/field.jsx';
import MonthYearPicker from './MonthYearPicker.jsx';
import { useT } from '../i18n/index.jsx';

export const DEPARTMENTS = ['Engineering', 'Finance', 'Marketing', 'Operations', 'HR', 'Legal', 'Product', 'Design', 'Sales', 'Other'];
// A department a CV import brought in is kept as written and offered as its own
// choice; only its capitalisation is aligned with the list. It never becomes "Other".
export const department = value => { const text = String(value || '').trim(); return DEPARTMENTS.find(known => known.toLowerCase() === text.toLowerCase()) || text; };
export const departmentOptions = value => (!value || DEPARTMENTS.includes(value) ? DEPARTMENTS : [value, ...DEPARTMENTS]);

export default function CareerEntryFields({ value, onChange, required = true, descriptionLabel }) {
  const { t } = useT();
  const change = (field, next) => onChange({ ...value, [field]: next });
  const suffix = required ? ' *' : '';
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Field label={`${t('profile.career.roleTitle').replace(' *', '')}${suffix}`} value={value.role} onChange={event => change('role', event.target.value)} maxLength={160} />
    <Field label={`${t('profile.career.department').replace(' *', '')}${suffix}`} as="select" value={value.department} onChange={event => change('department', event.target.value)}>
      <option value="">{t('onboarding.fields.selectDepartment')}</option>
      {departmentOptions(value.department).map(name => <option key={name} value={name}>{name}</option>)}
    </Field>
    <Field label={t('profile.career.company')} value={value.company} onChange={event => change('company', event.target.value)} maxLength={160} />
    <div className="career-period"><span className="career-period-label">{t('profile.career.from')}</span><MonthYearPicker value={value.start_date} onChange={next => change('start_date', next)} /></div>
    <div className="career-period"><span className="career-period-label">{t('profile.career.to')} <em>{t('profile.career.toHint')}</em></span><MonthYearPicker value={value.end_date} onChange={next => change('end_date', next)} /></div>
    <Field label={descriptionLabel || t('profile.career.description')} as="textarea" value={value.description || ''} onChange={event => change('description', event.target.value)} className="sm:col-span-2 lg:col-span-3" maxLength={2000} />
  </div>;
}
