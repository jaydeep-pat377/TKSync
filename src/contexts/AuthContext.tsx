import React, {createContext, useContext, useState, useCallback, useEffect, useMemo} from 'react';
import {DeviceEventEmitter, AppState} from 'react-native';
import type {AppStateStatus} from 'react-native';
import {storage} from '../services/storage';
import {
  authApi,
  ApiError,
  setOnSessionExpired,
  type CompanyLoginResponse,
  type DriverLoginResponse,
} from '../services/api';
import {setSentryUser} from '../services/sentry';
import {showToast} from '../utils/toast';
import {registerDevice, unregisterDevice, setupTokenRefreshListener, setupForegroundHandler, FORCE_LOGOUT_EVENT} from '../services/notifications';
import {IDLE_AUTO_LOGOUT_EVENT} from '../services/backgroundGpsTracker';
import {offlineStorage} from '../services/offlineStorage';

type CompanyInfo = {
  company_id: number;
  company_name: string;
  company_code: string;
};

type DriverInfo = {
  driver_id: number;
  driver_code: string;
  driver_name: string;
  truck_id: number;
  truck_code: string;
};

type AuthState = {
  isLoading: boolean;
  isCompanyLoggedIn: boolean;
  isDriverLoggedIn: boolean;
  company: CompanyInfo | null;
  driver: DriverInfo | null;
};

type AuthContextType = AuthState & {
  companyLogin: (companyCode: string) => Promise<void>;
  driverLogin: (truckCode: string, employeeCode: string) => Promise<void>;
  driverLogout: () => Promise<void>;
  companyLogout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isCompanyLoggedIn: false,
    isDriverLoggedIn: false,
    company: null,
    driver: null,
  });

  // Restore session from storage on mount
  useEffect(() => {
    const accessToken = storage.getString('access_token');
    const companyJson = storage.getString('company');
    const driverJson = storage.getString('driver');

    if (accessToken && companyJson) {
      const company: CompanyInfo = JSON.parse(companyJson);
      let driver: DriverInfo | null = null;
      let isDriverLoggedIn = false;

      if (driverJson) {
        driver = JSON.parse(driverJson);
        isDriverLoggedIn = true;
      }

      setState({
        isLoading: false,
        isCompanyLoggedIn: true,
        isDriverLoggedIn,
        company,
        driver,
      });

      if (isDriverLoggedIn) {
        registerDevice();
      }
    } else {
      setState(prev => ({...prev, isLoading: false}));
    }
  }, []);

  const companyLogin = useCallback(async (companyCode: string) => {
    const {data} = await authApi.companyLogin(companyCode);

    const company: CompanyInfo = {
      company_id: data.company_id,
      company_name: data.company_name,
      company_code: data.company_code,
    };

    storage.set('access_token', data.access_token);
    storage.set('refresh_token', data.refresh_token);
    storage.set('company', JSON.stringify(company));
    storage.remove('driver');

    setState({
      isLoading: false,
      isCompanyLoggedIn: true,
      isDriverLoggedIn: false,
      company,
      driver: null,
    });
  }, []);

  const driverLogin = useCallback(
    async (truckCode: string, employeeCode: string) => {
      const {data} = await authApi.driverLogin(truckCode, employeeCode);

      const driver: DriverInfo = {
        driver_id: data.driver_id,
        driver_code: data.driver_code,
        driver_name: data.driver_name,
        truck_id: data.truck_id,
        truck_code: data.truck_code,
      };

      storage.set('access_token', data.access_token);
      storage.set('refresh_token', data.refresh_token);
      storage.set('driver', JSON.stringify(driver));

      setSentryUser({
        id: String(data.driver_id),
        driverCode: data.driver_code,
        truckCode: data.truck_code,
        companyCode: state.company?.company_code,
      });

      setState(prev => ({
        ...prev,
        isDriverLoggedIn: true,
        driver,
      }));

      registerDevice();
    },
    [state.company],
  );

  const driverLogout = useCallback(async () => {
    // Upload GPS data BEFORE clearing driver — needs driver token to upload
    try {
      const {backgroundGpsTracker} = require('../services/backgroundGpsTracker');
      await backgroundGpsTracker.clearAllData();
    } catch {
      // non-fatal — GPS data may be orphaned
    }

    await unregisterDevice();
    try {
      const {data} = await authApi.driverLogout();
      storage.set('access_token', data.access_token);
      storage.set('refresh_token', data.refresh_token);
      storage.remove('driver');
    } catch {
      // Even if API fails (offline), clear driver locally.
      // Server session expires naturally via token expiry.
      storage.remove('driver');
    }

    setSentryUser(null);

    setState(prev => ({
      ...prev,
      isDriverLoggedIn: false,
      driver: null,
    }));
  }, []);

  const companyLogout = useCallback(async () => {
    // Upload GPS data BEFORE clearing tokens — needs auth to upload
    if (state.isDriverLoggedIn) {
      try {
        const {backgroundGpsTracker} = require('../services/backgroundGpsTracker');
        await backgroundGpsTracker.clearAllData();
      } catch {
        // non-fatal — GPS data may be orphaned
      }
    }

    await unregisterDevice();
    try {
      await authApi.companyLogout();
    } catch {
      // Even if API fails (offline), clear everything locally.
      // Server session expires naturally via token expiry.
    }

    setSentryUser(null);

    storage.remove('access_token');
    storage.remove('refresh_token');
    storage.remove('company');
    storage.remove('driver');
    storage.remove('notification_history');
    storage.remove('pending_missing_fields');
    storage.remove('pending_notification_nav');
    storage.remove('orphaned_gps_token');
    offlineStorage.clearAll();

    setState({
      isLoading: false,
      isCompanyLoggedIn: false,
      isDriverLoggedIn: false,
      company: null,
      driver: null,
    });
  }, [state.isDriverLoggedIn]);

  // Setup FCM token refresh and foreground push listeners
  useEffect(() => {
    if (!state.isDriverLoggedIn) return;
    const unsubRefresh = setupTokenRefreshListener();
    const unsubForeground = setupForegroundHandler();
    return () => { unsubRefresh(); unsubForeground(); };
  }, [state.isDriverLoggedIn]);

  // Force logout — uploads GPS data, then clears everything locally
  // (server already closed the session), redirects to company login screen
  const forceLogoutCleanup = useCallback(async () => {
    setSentryUser(null);

    // Upload GPS data and stop tracking BEFORE clearing tokens
    try {
      const {backgroundGpsTracker} = require('../services/backgroundGpsTracker');
      await backgroundGpsTracker.clearAllData();
    } catch (e) {
      // non-fatal
    }

    // Now clear all tokens and stored data
    storage.remove('access_token');
    storage.remove('refresh_token');
    storage.remove('company');
    storage.remove('driver');
    storage.remove('fcm_token');
    storage.remove('force_logout');
    storage.remove('notification_history');
    storage.remove('pending_missing_fields');
    storage.remove('pending_notification_nav');
    storage.remove('orphaned_gps_token');
    offlineStorage.clearAll();

    // Full state reset — back to company login
    setState({
      isLoading: false,
      isCompanyLoggedIn: false,
      isDriverLoggedIn: false,
      company: null,
      driver: null,
    });

    showToast('error', 'Logged Out', 'You have been logged out by the dispatcher.');
  }, []);

  // Listen for force_logout push (foreground) and check flag (background/killed)
  useEffect(() => {
    // Check if force_logout was received while app was in background/killed
    const pendingForceLogout = storage.getString('force_logout');
    if (pendingForceLogout === 'true') {
      (async () => { await forceLogoutCleanup(); })();
      return;
    }

    if (!state.isDriverLoggedIn) return;

    // Listen for force_logout event (foreground push)
    const sub = DeviceEventEmitter.addListener(FORCE_LOGOUT_EVENT, async () => {
      await forceLogoutCleanup();
    });

    // Check for pending force_logout when app returns from background —
    // the background push handler sets the flag, but this useEffect doesn't
    // re-run because deps haven't changed. AppState listener catches it.
    const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        const pending = storage.getString('force_logout');
        if (pending === 'true') {
          forceLogoutCleanup();
        }
      }
    });

    return () => { sub.remove(); appStateSub.remove(); };
  }, [state.isDriverLoggedIn, forceLogoutCleanup]);

  // Idle auto-logout: driver logout only (keep company selected)
  useEffect(() => {
    if (!state.isDriverLoggedIn) return;

    const sub = DeviceEventEmitter.addListener(IDLE_AUTO_LOGOUT_EVENT, () => {
      showToast('error', 'Auto Logout', 'You have been logged out due to 2 hours of inactivity.');
      driverLogout();
    });

    return () => sub.remove();
  }, [state.isDriverLoggedIn, driverLogout]);

  useEffect(() => {
    setOnSessionExpired(() => {
      // Skip if force_logout is pending — forceLogoutCleanup handles it on resume.
      if (storage.getString('force_logout') === 'true') return;
      // Skip if already handled — prevents multiple toasts from concurrent 401s
      if (!storage.getString('access_token')) return;

      setSentryUser(null);
      storage.remove('access_token');
      storage.remove('refresh_token');
      storage.remove('company');
      storage.remove('driver');
      storage.remove('notification_history');
      storage.remove('pending_missing_fields');
      storage.remove('pending_notification_nav');
      storage.remove('orphaned_gps_token');
      offlineStorage.clearAll();
      setState({
        isLoading: false,
        isCompanyLoggedIn: false,
        isDriverLoggedIn: false,
        company: null,
        driver: null,
      });
      showToast('error', 'Session Expired', 'Your session has expired. Please log in again.');
    });
    return () => setOnSessionExpired(null);
  }, []);

  const value = useMemo(() => ({
    ...state, companyLogin, driverLogin, driverLogout, companyLogout,
  }), [state, companyLogin, driverLogin, driverLogout, companyLogout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
