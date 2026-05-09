import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';

const NAV_CONFIG = {
  admin: [
    { label: 'Admin Panel', path: '/admin' },
    { label: 'Observability', path: '/observability' },
    { label: 'Dashboard', path: '/dashboard' },
  ],
  moderator: [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Traceability', path: '/traceability' },
    { label: 'Investigation Hub', path: '/investigate' },
    { label: 'Copilot', path: '/copilot', badge: 'LIVE' },
  ],
  registrar: [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Intake', path: '/intake' },
  ],
};

const ROLE_BADGE = {
  admin: { label: 'ADMIN', bg: '#fef3c7', color: '#92400e' },
  moderator: { label: 'MODERATOR', bg: '#dbeafe', color: '#1e40af' },
  registrar: { label: 'REGISTRAR', bg: '#f3f4f6', color: '#374151' },
};

export default function TopNavBar() {
  const { user, role, loading, isAuthenticated, logout } = useAuth();

  if (loading) {
    return null;
  }

  const navItems = NAV_CONFIG[role] || NAV_CONFIG.registrar;
  const badge = ROLE_BADGE[role] || ROLE_BADGE.registrar;
  const displayEmail = user?.email || 'Signed in';
  const avatarText = (displayEmail[0] || 'U').toUpperCase();

  return (
    <header className="top-nav">
      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
        <span className="nav-brand">AuraQC Studio</span>
        {isAuthenticated ? (
          <nav className="nav-links">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                  <span>{item.label}</span>
                  {item.badge ? (
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#166534', background: '#dcfce7', padding: '0.12rem 0.35rem', borderRadius: '999px' }}>
                      {item.badge}
                    </span>
                  ) : null}
                </span>
              </NavLink>
            ))}
          </nav>
        ) : null}
      </div>

      <div className="nav-actions">
        {isAuthenticated ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--on-surface-variant)', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {displayEmail}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                background: badge.bg,
                color: badge.color,
                padding: '0.22rem 0.5rem',
                borderRadius: '999px',
              }}
            >
              {badge.label}
            </span>
            <div className="avatar" title={displayEmail} style={{ display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>
              {avatarText}
            </div>
            <button className="btn-outline" style={{ padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-md)', fontSize: 12 }} onClick={() => { void logout(); }}>
              Sign Out
            </button>
          </>
        ) : (
          <NavLink to="/login" className="btn-outline" style={{ padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-md)', fontSize: 12 }}>
            Sign In
          </NavLink>
        )}
      </div>
    </header>
  );
}
