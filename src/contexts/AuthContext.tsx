import React, {createContext, useContext, useState, useCallback, useEffect} from 'react';
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
    },
    [state.company],
  );

  const driverLogout = useCallback(async () => {
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

    setState({
      isLoading: false,
      isCompanyLoggedIn: false,
      isDriverLoggedIn: false,
      company: null,
      driver: null,
    });
  }, []);

  useEffect(() => {
    setOnSessionExpired(() => {
      setSentryUser(null);
      storage.remove('access_token');
      storage.remove('refresh_token');
      storage.remove('company');
      storage.remove('driver');
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

  return (
    <AuthContext.Provider
      value={{...state, companyLogin, driverLogin, driverLogout, companyLogout}}>
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
