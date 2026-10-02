import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from './i18n/index.jsx';
import { Button } from './components/ui/button.jsx';

const LandingPage = lazy(() => import('./pages/LandingPage.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const RequestAccess = lazy(() => import('./pages/RequestAccess.jsx'));
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation.jsx'));
const ForcePasswordChange = lazy(() => import('./pages/ForcePasswordChange.jsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Explorer = lazy(() => import('./pages/Explorer.jsx'));
const Conversations = lazy(() => import('./pages/Conversations.jsx'));
const Groups = lazy(() => import('./pages/Groups.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const AdminOps = lazy(() => import('./pages/AdminOps.jsx'));
const KnowledgeGraph = lazy(() => import('./pages/KnowledgeGraph.jsx'));
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'));
const CalendarCallback = lazy(() => import('./pages/CalendarCallback.jsx'));
const AppLayout = lazy(() => import('./components/AppLayout.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

const PUBLIC_META = {
  '/welcome': ['landing.hero.title', 'landing.hero.subtitle'],
  '/login': ['auth.login.title', 'auth.login.description'],
  '/request-access': ['auth.requestAccess.title', 'auth.requestAccess.description'],
  '/terms': ['legal.terms.title', 'legal.terms.intro'],
  '/privacy': ['legal.privacy.title', 'legal.privacy.intro'],
};

const APP_TITLES = {
  '/': 'nav.home', '/explorer': 'nav.explorer', '/conversations': 'nav.messages',
  '/groups': 'nav.groups', '/profile': 'nav.myProfile', '/admin': 'nav.admin',
  '/admin/ops': 'nav.platformOps', '/admin/graph': 'nav.knowledgeGraph',
};

function updateMeta(selector, attribute, value) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.append(element);
  }
  element.setAttribute(attribute, value);
}

function PageMetadata() {
  const { pathname } = useLocation();
  const { t, lang } = useT();

  useEffect(() => {
    const routeMeta = PUBLIC_META[pathname];
    const titleKey = routeMeta?.[0] || APP_TITLES[pathname]
      || (pathname.startsWith('/profile/') ? 'nav.myProfile' : null);
    const title = titleKey ? `${t(titleKey)} | Ment` : 'Ment';
    const description = routeMeta ? t(routeMeta[1]) : '';
    const indexable = ['/welcome', '/request-access', '/terms', '/privacy'].includes(pathname);

    document.title = title;
    document.documentElement.lang = lang;
    updateMeta('meta[name="robots"]', 'name', indexable ? 'index,follow' : 'noindex,nofollow');
    if (description) updateMeta('meta[name="description"]', 'name', description);
    else document.head.querySelector('meta[name="description"]')?.remove();
    updateMeta('meta[property="og:title"]', 'property', title);
    updateMeta('meta[property="og:description"]', 'property', description || title);
    updateMeta('meta[property="og:type"]', 'property', 'website');
    updateMeta('meta[property="og:url"]', 'property', `${window.location.origin}${pathname}`);
  }, [lang, pathname, t]);

  return null;
}

function page(node, animate = true) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      {animate ? <PageTransition>{node}</PageTransition> : node}
    </Suspense>
  );
}

function PageTransition({ children }) {
  const { pathname } = useLocation();
  return <div key={pathname} className="page-transition">{children}</div>;
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

function ProfileLoadError() {
  const { refreshProfile } = useAuth();
  const { t } = useT();
  return <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
    <p>{t('auth.profileLoadError')}</p>
    <Button onClick={refreshProfile}>{t('auth.profileRetry')}</Button>
  </div>;
}

function authGatePath(user) {
  if (user?.must_change_password) return '/change-password';
  if (user && !user.onboarding_complete && !user.is_admin) return '/onboarding';
  return null;
}

function homePath(user) {
  if (user.is_admin) return '/admin';
  return user.role === 'alumnus' ? '/conversations' : '/';
}

function returnPath(location) {
  const from = location?.state?.from;
  const path = typeof from === 'string'
    ? from
    : from && `${from.pathname || ''}${from.search || ''}${from.hash || ''}`;
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
    ? path
    : null;
}

// `/login` lives outside the protected tree. Once the user signs in we need an
// explicit guard to push them to wherever the protected tree would have sent
// them — change-password / onboarding / home / admin — instead of leaving them
// on the form.
function LoginRoute() {
  const { user, loading, profileError } = useAuth();
  const location = useLocation();
  const destination = returnPath(location);
  if (loading) return <LoadingScreen />;
  if (profileError) return <ProfileLoadError />;
  if (user) {
    const gate = authGatePath(user);
    if (gate) return <Navigate to={gate} state={{ returnTo: destination }} replace />;
    if (destination) return <Navigate to={destination} replace />;
    // Students arrive to find someone, so they land in the discovery chat.
    // Alumni never search — they respond — so they land in Messages. This is
    // the landing route only; both keep the same sidebar and can reach either.
    return <Navigate to={homePath(user)} replace />;
  }
  return page(<Login />);
}

function ProtectedRoute() {
  const { user, loading, profileError } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (profileError && !user) return <ProfileLoadError />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  const gate = authGatePath(user);
  if (gate) return <Navigate to={gate} state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }} replace />;
  return page(<AppLayout />, false);
}

function ChangePasswordRoute() {
  const { user, loading, profileError } = useAuth();
  const location = useLocation();
  const destination = location.state?.returnTo;
  if (loading) return <LoadingScreen />;
  if (profileError && !user) return <ProfileLoadError />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.must_change_password) return <Navigate to={destination || homePath(user)} replace />;
  return page(<ForcePasswordChange />);
}

function PasswordRecoveryRoute() {
  return page(<ForcePasswordChange recovery />);
}

function OnboardingRoute() {
  const { user, loading, profileError } = useAuth();
  const location = useLocation();
  const destination = location.state?.returnTo;
  if (loading) return <LoadingScreen />;
  if (profileError && !user) return <ProfileLoadError />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to={authGatePath(user)} replace />;
  if (user.onboarding_complete || user.is_admin) return <Navigate to={destination || homePath(user)} replace />;
  return page(
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-2xl px-4 py-10">
        <Onboarding returnTo={destination} />
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
    <>
    <PageMetadata />
    <Routes>
      <Route path="/welcome" element={page(<LandingPage />)} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/sign-up" element={<Navigate to="/request-access" replace />} />
      <Route path="/request-access" element={page(<RequestAccess />)} />
      <Route path="/invite/:token" element={page(<AcceptInvitation />)} />
      <Route path="/terms" element={page(<LegalPage type="terms" />)} />
      <Route path="/privacy" element={page(<LegalPage type="privacy" />)} />
      <Route path="/calendar/callback" element={page(<CalendarCallback />)} />
      <Route path="/change-password" element={<ChangePasswordRoute />} />
      <Route path="/reset-password" element={<PasswordRecoveryRoute />} />
      <Route path="/onboarding" element={<OnboardingRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<UserRoute>{page(<Dashboard />)}</UserRoute>} />
        <Route path="/explorer" element={<UserRoute>{page(<Explorer />)}</UserRoute>} />
        <Route path="/conversations" element={<UserRoute>{page(<Conversations />)}</UserRoute>} />
        <Route path="/groups" element={<UserRoute>{page(<Groups />)}</UserRoute>} />
        <Route path="/profile" element={<UserRoute>{page(<Profile />)}</UserRoute>} />
        <Route path="/profile/:id" element={<UserRoute>{page(<Profile />)}</UserRoute>} />
        <Route path="/admin" element={<AdminRoute>{page(<AdminDashboard />)}</AdminRoute>} />
        <Route path="/admin/ops" element={<PlatformAdminRoute>{page(<AdminOps />)}</PlatformAdminRoute>} />
        <Route path="/admin/graph" element={<AdminRoute>{page(<KnowledgeGraph />)}</AdminRoute>} />
      </Route>
      <Route path="*" element={page(<NotFound />)} />
    </Routes>
    </>
  );
}
