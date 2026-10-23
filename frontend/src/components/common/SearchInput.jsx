import React from 'react';
import Icon from './IconMap';

export default function SearchInput({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="search-input-wrap">
      <span className="search-icon"><Icon name="Search" size={14} /></span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
