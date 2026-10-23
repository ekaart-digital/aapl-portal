import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { landingFor } from '../auth/roles';

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="page-loading"><span className="spinner" />Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

// Lets in anyone whose role holds the capability; everyone else goes home.
export function RequireCapability({ capability }) {
  const { user, can } = useAuth();
  if (!can(capability)) return <Navigate to={landingFor(user)} replace />;
  return <Outlet />;
}

export function RoleLanding() {
  const { user } = useAuth();
  return <Navigate to={landingFor(user)} replace />;
}
