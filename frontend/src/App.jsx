import React from 'react';
import { BrowserRouter, Navigate, Routes, Route, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth/useAuth';
import TopNavBar from './components/layout/TopNavBar';
import StatusBar from './components/shared/StatusBar';
import TelemetryStrip from './components/shared/TelemetryStrip';
import ProtectedRoute from './components/shared/ProtectedRoute';
import AdminPage from './pages/admin/AdminPage';
import CommandCenter from './pages/misc/CommandCenter';
import InvestigationHub from './pages/investigation/InvestigationHub';
import LoginPage from './pages/auth/LoginPage';
import TraceabilityMatrix from './pages/misc/TraceabilityMatrix';
import RCACopilotPage from './pages/investigation/RCACopilotPage';
import ObservabilityPage from './pages/observability/ObservabilityPage';
import DataIntakePage from './pages/intake/DataIntakePage';
import './index.css';

function ProtectedPage({ children, allowedRoles = null }) {
  return <ProtectedRoute allowedRoles={allowedRoles}>{children}</ProtectedRoute>;
}

function RoleHomeRedirect() {
  const { role } = useAuth();
  if (role === 'admin') {
    return <Navigate to="/admin" replace />;
  }
  if (role === 'moderator') {
    return <Navigate to="/dashboard" replace />;
  }
  if (role === 'registrar') {
    return <Navigate to="/intake" replace />;
  }
  return <Navigate to="/login" replace />;
}

function DashboardEntry() {
  const { role } = useAuth();
  if (role === 'admin') {
    return <Navigate to="/admin" replace />;
  }
  return <CommandCenter />;
}

function LegacyRedirect({ stage }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const nextParams = new URLSearchParams(searchParams);
  nextParams.set('stage', nextParams.get('stage') || stage);
  if (id) {
    nextParams.set('clusters', id);
  }
  const target = `/investigate?${nextParams.toString()}`;
  return <Navigate to={target} replace />;
}

function AppLayout() {
  const location = useLocation();
  const { loading, user, token } = useAuth();
  const isLoginRoute = location.pathname === '/login';
  const isAdminRoute = location.pathname.startsWith('/admin');
  const showChrome = !isLoginRoute && !isAdminRoute && !loading && Boolean(user && token);

  return (
    <div className="app-shell">
      {showChrome ? <TopNavBar /> : null}
      <div className="app-main" style={isLoginRoute ? { paddingRight: 0 } : undefined}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedPage><RoleHomeRedirect /></ProtectedPage>} />
          <Route path="/dashboard" element={<ProtectedPage allowedRoles={['admin', 'moderator', 'registrar']}><DashboardEntry /></ProtectedPage>} />
          <Route path="/admin" element={<ProtectedPage allowedRoles={['admin']}><AdminPage /></ProtectedPage>} />
          <Route path="/triage" element={<LegacyRedirect stage="1" />} />
          <Route path="/investigation/:id" element={<LegacyRedirect stage="2" />} />
          <Route path="/investigate/:id" element={<LegacyRedirect stage="2" />} />
          <Route path="/traceability" element={<ProtectedPage allowedRoles={['admin', 'moderator']}><TraceabilityMatrix /></ProtectedPage>} />
          <Route path="/copilot" element={<ProtectedPage allowedRoles={['moderator']}><RCACopilotPage /></ProtectedPage>} />
          <Route path="/copilot-v2" element={<ProtectedPage allowedRoles={['moderator']}><RCACopilotPage /></ProtectedPage>} />
          <Route path="/intake" element={<ProtectedPage allowedRoles={['registrar']}><DataIntakePage /></ProtectedPage>} />
          <Route path="/observability" element={<ProtectedPage allowedRoles={['admin']}><ObservabilityPage /></ProtectedPage>} />
          <Route path="/resolution" element={<LegacyRedirect stage="3" />} />
          <Route path="/resolution/:id" element={<LegacyRedirect stage="3" />} />
          <Route path="/workflow" element={<LegacyRedirect stage="1" />} />
          <Route path="/workflow/:id" element={<LegacyRedirect stage="1" />} />
          <Route path="/hub" element={<LegacyRedirect stage="1" />} />
          <Route path="/hub/:id" element={<LegacyRedirect stage="1" />} />
          <Route path="/investigate" element={<ProtectedPage allowedRoles={['moderator']}><InvestigationHub /></ProtectedPage>} />
        </Routes>
      </div>
      {showChrome ? <TelemetryStrip /> : null}
      {showChrome ? <StatusBar /> : null}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export default App;
