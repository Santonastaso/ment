import React from 'react';

const slots = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);

export default function TimeSlotSelect({ value, onChange, label, min }) {
  const day = value?.slice(0, 10);
  const time = value?.slice(11, 16) || '';
  const available = slots.filter(slot => !min || day !== min.slice(0, 10) || slot >= min.slice(11, 16));
  return <label className="label">{label}
    <select className="input mt-1" aria-label={label} value={time} onChange={event => onChange(`${day}T${event.target.value}`)}>
      {time && !available.includes(time) && <option value={time}>{time}</option>}
      {available.map(slot => <option key={slot} value={slot}>{slot}</option>)}
    </select>
  </label>;
}
