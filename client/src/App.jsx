import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Skeleton } from '@/components/ui/skeleton';

const LandingPage = lazy(() => import('./pages/LandingPage.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const RequestAccess = lazy(() => import('./pages/RequestAccess.jsx'));
const SignUp = lazy(() => import('./pages/SignUp.jsx'));
const ForcePasswordChange = lazy(() => import('./pages/ForcePasswordChange.jsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Explorer = lazy(() => import('./pages/Explorer.jsx'));
const Groups = lazy(() => import('./pages/Groups.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const AdminOps = lazy(() => import('./pages/AdminOps.jsx'));
const KnowledgeGraph = lazy(() => import('./pages/KnowledgeGraph.jsx'));
const AppLayout = lazy(() => import('./components/AppLayout.jsx'));

function page(node) {
  return <Suspense fallback={<LoadingScreen />}>{node}</Suspense>;
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

// `/login` lives outside the protected tree. Once the user signs in we need an
// explicit guard to push them to wherever the protected tree would have sent
// them — change-password / onboarding / home / admin — instead of leaving them
// on the form.
function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) {
    if (user.must_change_password) return <Navigate to="/change-password" replace />;
    if (!user.onboarding_complete && !user.is_admin) return <Navigate to="/onboarding" replace />;
    if (user.is_admin) return <Navigate to="/admin" replace />;
    return <Navigate to="/" replace />;
  }
  return page(<Login />);
}

function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/welcome" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  if (!user.onboarding_complete && !user.is_admin) return <Navigate to="/onboarding" replace />;
  return page(<AppLayout />);
}

function ChangePasswordRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.must_change_password) {
    if (user.is_admin) return <Navigate to="/admin" replace />;
    if (!user.onboarding_complete) return <Navigate to="/onboarding" replace />;
    return <Navigate to="/" replace />;
  }
  return page(<ForcePasswordChange />);
}

function OnboardingRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  if (user.onboarding_complete) return <Navigate to="/" replace />;
  return page(
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Onboarding />
      </main>
    </div>
  );
}

function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!user?.is_admin) return <Navigate to="/" replace />;
  return children;
}

function PlatformAdminRoute({ children }) {
  const { user } = useAuth();
  if (!user?.is_admin) return <Navigate to="/" replace />;
  if (user.admin_scope !== 'platform') return <Navigate to="/admin" replace />;
  return children;
}

function UserRoute({ children }) {
  const { user } = useAuth();
  if (user?.is_admin) return <Navigate to="/admin" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/welcome" element={page(<LandingPage />)} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/sign-up" element={page(<SignUp />)} />
      <Route path="/request-access" element={page(<RequestAccess />)} />
      <Route path="/change-password" element={<ChangePasswordRoute />} />
      <Route path="/onboarding" element={<OnboardingRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<UserRoute>{page(<Dashboard />)}</UserRoute>} />
        <Route path="/explorer" element={<UserRoute>{page(<Explorer />)}</UserRoute>} />
        <Route path="/groups" element={<UserRoute>{page(<Groups />)}</UserRoute>} />
        <Route path="/profile" element={<UserRoute>{page(<Profile />)}</UserRoute>} />
        <Route path="/profile/:id" element={<UserRoute>{page(<Profile />)}</UserRoute>} />
        <Route path="/admin" element={<AdminRoute>{page(<AdminDashboard />)}</AdminRoute>} />
        <Route path="/admin/ops" element={<PlatformAdminRoute>{page(<AdminOps />)}</PlatformAdminRoute>} />
        <Route path="/admin/graph" element={<AdminRoute>{page(<KnowledgeGraph />)}</AdminRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
