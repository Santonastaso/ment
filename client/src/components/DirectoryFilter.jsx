import React from 'react';
import { Select } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { buttonVariants } from './ui/button.jsx';

export default function DirectoryFilter({ label, value, onChange, options }) {
  return <Select.Root value={value} onValueChange={onChange} items={options}>
    <Select.Trigger className={buttonVariants({ variant: 'ghost', className: 'filter-control directory-filter w-full min-w-0 justify-between font-normal' })} aria-label={label}>
      <Select.Value placeholder={options[0]?.label} />
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
