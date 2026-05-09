import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';

const ADMIN_TABS = [
  { key: 'users', label: 'Users' },
  { key: 'health', label: 'System Health' },
  { key: 'audit', label: 'Audit Log' },
  { key: 'clusters', label: 'Cluster Governance' },
];

export default function AdminNavBar({ activePanel, setActivePanel }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const displayEmail = user?.email || 'admin@local';
  const avatarText = (displayEmail[0] || 'A').toUpperCase();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 'var(--nav-height)',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.5rem',
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(226, 232, 240, 0.5)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--on-surface)' }}>
            AuraQC Studio
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              background: '#fef3c7',
              color: '#92400e',
              padding: '0.22rem 0.5rem',
              borderRadius: '999px',
            }}
          >
            Admin
          </span>
        </div>

        <nav
          aria-label="Admin sections"
          style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', height: '100%' }}
        >
          {[
            { to: '/traceability', label: 'Traceability' },
            { to: '/observability', label: 'Observability' },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                letterSpacing: '-0.01em',
                color: isActive ? 'var(--secondary)' : '#64748b',
                transition: 'color 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                height: '100%',
                borderBottom: isActive ? '2px solid var(--secondary)' : '2px solid transparent',
                paddingBottom: 2,
                textDecoration: 'none',
              })}
            >
              {item.label}
            </NavLink>
          ))}
          {ADMIN_TABS.map((tab) => {
            const isActive = activePanel === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActivePanel(tab.key)}
                style={{
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 500,
                  letterSpacing: '-0.01em',
                  color: isActive ? 'var(--secondary)' : '#64748b',
                  transition: 'color 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  height: '100%',
                  borderBottom: isActive ? '2px solid var(--secondary)' : '2px solid transparent',
                  paddingBottom: 2,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span style={{ fontSize: 12, color: 'var(--on-surface-variant)', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {displayEmail}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background: '#fef3c7',
            color: '#92400e',
            padding: '0.22rem 0.5rem',
            borderRadius: '999px',
          }}
        >
          ADMIN
        </span>
        <div
          title={displayEmail}
          style={{
            width: 32,
            height: 32,
            borderRadius: '9999px',
            overflow: 'hidden',
            border: '1px solid var(--outline-variant)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--on-surface)',
            background: 'var(--surface-container-lowest)',
          }}
        >
          {avatarText}
        </div>
        <button
          className="btn-outline"
          type="button"
          style={{ padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--error)' }}
          onClick={() => { void handleLogout(); }}
        >
          Sign Out
        </button>
      </div>
    </header>
  );
}
