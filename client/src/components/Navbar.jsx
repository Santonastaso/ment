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

  return (
    <nav className="bg-navy shadow-sm">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-white font-bold text-xl tracking-tight">MENT</Link>
            <div className="hidden md:flex items-center gap-6">
              <Link
                to="/"
                className={`text-sm font-medium transition-colors ${isActive('/') ? 'text-white' : 'text-blue-200 hover:text-white'}`}
              >
                Dashboard
              </Link>
              <Link
                to="/explorer"
                className={`text-sm font-medium transition-colors ${isActive('/explorer') ? 'text-white' : 'text-blue-200 hover:text-white'}`}
              >
                Explorer
              </Link>
              <Link
                to="/profile"
                className={`text-sm font-medium transition-colors ${isActive('/profile') ? 'text-white' : 'text-blue-200 hover:text-white'}`}
              >
                My Profile
              </Link>
              {user?.direct_reports > 0 && (
                <Link
                  to="/team"
                  className={`text-sm font-medium transition-colors ${isActive('/team') ? 'text-white' : 'text-blue-200 hover:text-white'}`}
                >
                  Team
                </Link>
              )}
              {user?.is_admin && (
                <Link
                  to="/admin"
                  className={`text-sm font-medium transition-colors ${isActive('/admin') ? 'text-white' : 'text-blue-200 hover:text-white'}`}
                >
                  Admin
                </Link>
              )}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-4">
            <div className="text-right leading-tight">
              <div className="text-blue-100 text-sm font-medium">{user?.name}</div>
              <div className="text-blue-300 text-[11px]">{user?.email}</div>
            </div>
            <button
              onClick={handleLogout}
              className="text-sm text-blue-200 hover:text-white transition-colors font-medium"
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
          <div className="md:hidden pb-4 border-t border-navy-light pt-4 space-y-2">
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
