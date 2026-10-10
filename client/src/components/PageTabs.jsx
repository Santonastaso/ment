import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** Underline tabs under the page title. Panels use `${idPrefix}-panel-${key}`. */
export default function PageTabs({ tabs, value, onChange, idPrefix, label, className }) {
  const stripRef = useRef(null);

  function onKeyDown(event, key) {
    const index = tabs.findIndex(tab => tab.key === key);
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    stripRef.current?.querySelectorAll('[role="tab"]')[nextIndex]?.focus({ preventScroll: true });
    onChange(tabs[nextIndex].key);
  }

  // Scroll only the strip, so deep links and back/forward never move the page.
  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector('[aria-selected="true"]');
    if (!active) return;
    const bounds = strip.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.left < bounds.left + 8) strip.scrollLeft += item.left - bounds.left - 8;
    else if (item.right > bounds.right - 28) strip.scrollLeft += item.right - bounds.right + 28;
  }, [value, tabs.length]);

  return (
    <div ref={stripRef} className={cn('page-tabs', className)} role="tablist" aria-label={label}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.key}`}
          data-testid={`${idPrefix}-tab-${tab.key}`}
          aria-selected={value === tab.key}
          aria-controls={`${idPrefix}-panel-${tab.key}`}
          tabIndex={value === tab.key ? 0 : -1}
          data-control-radius-exempt
          onClick={() => onChange(tab.key)}
          onKeyDown={event => onKeyDown(event, tab.key)}
          className="page-tab"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
