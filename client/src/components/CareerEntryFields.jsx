import { Field } from './ui/field.jsx';
import MonthYearPicker from './MonthYearPicker.jsx';
import { useT } from '../i18n/index.jsx';

export const DEPARTMENTS = ['Engineering', 'Finance', 'Marketing', 'Operations', 'HR', 'Legal', 'Product', 'Design', 'Sales', 'Other'];

export default function CareerEntryFields({ value, onChange }) {
  const { t } = useT();
  const change = (field, next) => onChange({ ...value, [field]: next });
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Field label={t('profile.career.roleTitle')} value={value.role} onChange={event => change('role', event.target.value)} maxLength={160} />
    <Field label={t('profile.career.department')} as="select" value={value.department} onChange={event => change('department', event.target.value)}>
      <option value="">{t('onboarding.fields.selectDepartment')}</option>
      {DEPARTMENTS.map(department => <option key={department} value={department}>{department}</option>)}
    </Field>
    <Field label={t('profile.career.company')} value={value.company} onChange={event => change('company', event.target.value)} maxLength={160} />
    <div className="career-period"><span className="career-period-label">{t('profile.career.from')}</span><MonthYearPicker value={value.start_date} onChange={next => change('start_date', next)} /></div>
    <div className="career-period"><span className="career-period-label">{t('profile.career.to')} <em>{t('profile.career.toHint')}</em></span><MonthYearPicker value={value.end_date} onChange={next => change('end_date', next)} /></div>
    <Field label={t('profile.career.description')} as="textarea" value={value.description || ''} onChange={event => change('description', event.target.value)} className="sm:col-span-2 lg:col-span-3" maxLength={2000} />
  </div>;
}
