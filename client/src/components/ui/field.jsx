import React, { useId } from 'react';
import { cn } from '@/lib/utils';

// Floating-label field. The label sits inside the control and rises to a small
// caption once the field has a value or focus, so a dense form stays readable
// without a separate row of labels above every input.
//
//   <Field label="Location" value={x} onChange={…} />
//   <Field label="Department" as="select" value={x} onChange={…}>…</Field>
//   <Field label="Program" value={x} readOnly hint="Set by your school" />
//
// A select always reads as filled: it shows a value from the start, so its
// label has nowhere to sit but the caption position.

export function Field({
  label,
  value,
  onChange,
  as = 'input',
  type = 'text',
  readOnly = false,
  hint,
  className,
  children,
  ...props
}) {
  const id = useId();
  const filled = as === 'select' || String(value ?? '').length > 0;

  const control =
    as === 'select' ? (
      <select id={id} value={value ?? ''} onChange={onChange} disabled={readOnly} {...props}>
        {children}
      </select>
    ) : as === 'textarea' ? (
      <textarea id={id} value={value ?? ''} onChange={onChange} readOnly={readOnly} {...props} />
    ) : (
      <input id={id} type={type} value={value ?? ''} onChange={onChange} readOnly={readOnly} {...props} />
    );

  return (
    <div
      className={cn(
        'floating-field',
        as === 'select' && 'is-select',
        as === 'textarea' && 'is-textarea',
        filled && 'is-filled',
        readOnly && 'is-readonly',
        className
      )}
    >
      {control}
      <label htmlFor={id}>{label}</label>
      {hint && <span className="floating-field-hint">{hint}</span>}
    </div>
  );
}
