import React from 'react';
import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { buttonVariants } from './ui/button.jsx';

/** Drop-in for a native <select>: same value, onChange(event) and <option> children, with the app's own list. */
export function Dropdown({ value, onChange, children, disabled, id, 'aria-label': label }) {
  const options = React.Children.toArray(children).map(({ props }) => ({ value: String(props.value ?? props.children), label: props.children }));
  return <DirectoryFilter id={id} label={label} placeholder={options[0]?.label} value={String(value ?? '')} disabled={disabled} options={options} onChange={next => onChange({ target: { value: next } })} />;
}

export default function DirectoryFilter({ label, placeholder = label, value, onChange, options, renderValue, multiple = false, disabled = false, id }) {
  return <Select.Root multiple={multiple} value={value} onValueChange={onChange} items={options} disabled={disabled}>
    <Select.Trigger className={buttonVariants({ variant: 'ghost', className: 'filter-control directory-filter w-full min-w-0 justify-between px-3 font-normal' })} aria-label={label} id={id}>
      <Select.Value className="min-w-0 truncate" placeholder={placeholder}>
        {selected => {
          // With nothing chosen the chip names what it filters ("Programme"),
          // not the catch-all option ("Tous les…"), which truncated to nothing.
          if (multiple ? !selected?.length : !selected) return placeholder;
          if (renderValue) return typeof renderValue === 'function' ? renderValue(selected) : renderValue;
          return options.find(option => option.value === selected)?.label ?? placeholder;
        }}
      </Select.Value>
      <Select.Icon><ChevronDown size={16} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner className="directory-filter-positioner" alignItemWithTrigger={false} sideOffset={6}>
        <Select.Popup className="directory-filter-popup">
          <Select.List>
            {options.map(option => <Select.Item key={option.value} value={option.value} className="directory-filter-option">
              <Select.ItemText>{option.label}</Select.ItemText>
              <Select.ItemIndicator><Check size={15} aria-hidden="true" /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>;
}
