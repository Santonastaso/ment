import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const isActive = (path) => location.pathname === path;

  // Active-state styling: a 2px navy-light underline anchored to the bottom of the nav
  // — a much clearer signal than a colour shift, and the standard pattern in Linear / Vercel.
  const linkClass = (path) =>
    `relative text-sm font-medium transition-colors py-5
     ${isActive(path)
        ? 'text-white after:absolute after:left-0 after:right-0 after:bottom-0 after:h-0.5 after:bg-white'
        : 'text-blue-200 hover:text-white'}`;

  const initials = (user?.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <nav className="bg-navy">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-white font-bold text-lg tracking-tight">MENT</Link>
            <div className="hidden md:flex items-center gap-6">
              <Link to="/" className={linkClass('/')}>Dashboard</Link>
              <Link to="/explorer" className={linkClass('/explorer')}>Explorer</Link>
              <Link to="/profile" className={linkClass('/profile')}>My Profile</Link>
              {user?.direct_reports > 0 && (
                <Link to="/team" className={linkClass('/team')}>Team</Link>
              )}
              {user?.is_admin && (
                <Link to="/admin" className={linkClass('/admin')}>Admin</Link>
              )}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-blue-50 text-sm font-medium">{user?.name}</div>
              <div className="text-blue-300 text-[11px]">{user?.email}</div>
            </div>
            {/* Avatar pill — small initials disc, signals identity without a photo upload */}
            <div className="w-9 h-9 rounded-full bg-navy-light flex items-center justify-center text-white text-xs font-semibold border border-white/10">
              {initials}
            </div>
            <button
              onClick={handleLogout}
              className="text-sm text-blue-200 hover:text-white transition-colors font-medium ml-1"
            >
              Sign out
            </button>
          </div>

          {/* Mobile menu button */}
          <button className="md:hidden text-white" onClick={() => setMenuOpen(!menuOpen)}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden pb-4 border-t border-white/10 pt-4 space-y-2">
            <Link to="/" className="block text-blue-200 hover:text-white text-sm py-1" onClick={() => setMenuOpen(false)}>Dashboard</Link>
            <Link to="/explorer" className="block text-blue-200 hover:text-white text-sm py-1" onClick={() => setMenuOpen(false)}>Explorer</Link>
            <Link to="/profile" className="block text-blue-200 hover:text-white text-sm py-1" onClick={() => setMenuOpen(false)}>My Profile</Link>
            {user?.direct_reports > 0 && <Link to="/team" className="block text-blue-200 hover:text-white text-sm py-1" onClick={() => setMenuOpen(false)}>Team</Link>}
            {user?.is_admin && <Link to="/admin" className="block text-blue-200 hover:text-white text-sm py-1" onClick={() => setMenuOpen(false)}>Admin</Link>}
            <button onClick={handleLogout} className="block text-blue-200 hover:text-white text-sm py-1 w-full text-left">Sign out</button>
          </div>
        )}
      </div>
    </nav>
  );
}
