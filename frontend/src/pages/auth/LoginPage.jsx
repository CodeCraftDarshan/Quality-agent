import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { supabase } from '../../lib/supabaseClient';

function getPostLoginPath(role) {
  if (role === 'admin') {
    return '/admin';
  }
  if (role === 'moderator') {
    return '/dashboard';
  }
  if (role === 'registrar') {
    return '/intake';
  }
  return '/login';
}

export default function LoginPage() {
  const { user, role, loading, login, token } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!loading && user && token) {
    return <Navigate to={getPostLoginPath(role)} replace />;
  }

  const onSignIn = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    const result = await login(email, password);
    if (!result.ok) {
      setError(result.error || 'Unable to sign in');
    }

    setIsSubmitting(false);
  };

  const onSignUp = async () => {
    setError('');
    setIsSubmitting(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
    } else {
      setError('Account created. Check your email for confirmation if required by your Supabase project settings.');
    }

    setIsSubmitting(false);
  };

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <section className="card" style={{ width: '100%', maxWidth: 460, padding: '2rem' }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--secondary)', marginBottom: '0.5rem' }}>
          AuraQC Secure Access
        </p>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>Sign in to continue</h1>
        <p style={{ color: 'var(--on-surface-variant)', marginBottom: '1.5rem' }}>
          Use your Supabase credentials to access investigation dashboards and realtime cluster streams.
        </p>
        <p style={{ color: 'var(--on-surface-variant)', marginBottom: '1rem', fontSize: 12 }}>
          Dev bypass: admin `1@gmail.com`, moderator `2@gmail.com`, registrar `3@gmail.com` / `1234`
        </p>

        <form onSubmit={onSignIn} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
              style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', outline: 'none' }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--on-surface-variant)' }}>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
              style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--outline-variant)', outline: 'none' }}
            />
          </label>

          {error ? (
            <p style={{ fontSize: 13, color: error.startsWith('Account created') ? 'var(--secondary)' : 'var(--error)' }}>{error}</p>
          ) : null}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="machined-btn" type="submit" disabled={isSubmitting} style={{ flex: 1, padding: '0.75rem', opacity: isSubmitting ? 0.7 : 1 }}>
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
            <button
              type="button"
              onClick={onSignUp}
              disabled={isSubmitting}
              className="btn-outline"
              style={{ flex: 1, padding: '0.75rem', opacity: isSubmitting ? 0.7 : 1 }}
            >
              Create Account
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
