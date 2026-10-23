import React from 'react';

const PALETTE = ['#1B4F72', '#B7791F', '#1F7A4D', '#6B4C9A', '#2B5F8A', '#8A4B3A'];

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export default function Avatar({ name, initials, size = 'md' }) {
  const cls = size === 'lg' ? 'avatar lg' : 'avatar';
  const color = hashColor(name || initials || '?');
  return (
    <div className={cls} style={{ background: `${color}1F`, color }}>
      {initials || (name ? name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() : '?')}
    </div>
  );
}
