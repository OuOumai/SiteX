import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api, ResponsableDashboardData } from '@/services/api';
import { ResponsableAnalyticalDashboard } from '@/components/dashboard/ResponsableAnalyticalDashboard';

/**
 * app/responsable/index.tsx
 *
 * Responsable Hub Supervision Route.
 * Consolidated with the canonical ResponsableAnalyticalDashboard to ensure
 * a single authoritative experience across all navigation entries (tab & drawer).
 */
export default function ResponsableDashboardScreen() {
  const { token, user } = useAuth();
  const [data, setData] = useState<ResponsableDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async (isRefresh = false) => {
    if (!token) return;
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const res = await api.getResponsableDashboard(token);
      setData(res);
    } catch (err: any) {
      console.error('Erreur chargement dashboard responsable:', err.message);
      setError(err.message || 'Impossible de charger les données du tableau de bord');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return (
    <ResponsableAnalyticalDashboard
      data={data}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      error={error}
      onRefresh={() => fetchDashboardData(true)}
      user={user}
    />
  );
}
