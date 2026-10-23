import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { navFor } from '../../data/navConfig';
import Icon from '../common/IconMap';

export default function Sidebar({ open = false }) {
  const { user, can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const sections = navFor(user.role, can);

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">AE</div>
        <div className="sidebar-brand-text">
          <div className="name">AAPL Platform</div>
          <div className="sub">Consulting Engineers LLC</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {sections.map((section, si) => (
          <div key={si}>
            {section.label ? <div className="sidebar-section-label">{section.label}</div> : null}
            {section.items.map((item) => {
              const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
              return (
                <div
                  key={item.path}
                  className={`sidebar-link ${isActive ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                >
                  <span className="sidebar-icon"><Icon name={item.icon} size={16} /></span>
                  {item.label}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        AAPL Platform &middot; v1
      </div>
    </aside>
  );
}
