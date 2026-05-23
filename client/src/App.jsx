import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import ForcePasswordChange from './pages/ForcePasswordChange.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Explorer from './pages/Explorer.jsx';
import Profile from './pages/Profile.jsx';
import TeamSkills from './pages/TeamSkills.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import AppLayout from './components/AppLayout.jsx';
import { Skeleton } from '@/components/ui/skeleton';

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
  return <Login />;
}

function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  if (!user.onboarding_complete && !user.is_admin) return <Navigate to="/onboarding" replace />;
  return (
    <AppLayout />
  );
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
  return <ForcePasswordChange />;
}

function OnboardingRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  if (user.onboarding_complete) return <Navigate to="/" replace />;
  return (
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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/change-password" element={<ChangePasswordRoute />} />
      <Route path="/onboarding" element={<OnboardingRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/explorer" element={<Explorer />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/:id" element={<Profile />} />
        <Route path="/team" element={<TeamSkills />} />
        <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
