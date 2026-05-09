import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';

function getHomePath(role) {
  if (role === 'admin') return '/admin';
  return role === 'registrar' ? '/intake' : '/dashboard';
}

export default function ProtectedRoute({ children, allowedRoles = null }) {
  const { user, role, loading, token } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
        <div className="card" style={{ padding: '1.5rem', maxWidth: 420, width: '100%' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.5rem' }}>Validating Session</h2>
          <p style={{ color: 'var(--on-surface-variant)' }}>Checking your secure AuraQC access token...</p>
        </div>
      </main>
    );
  }

  if (!user || !token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    return <Navigate to={getHomePath(role)} replace />;
  }

  return children;
}
