import React, {createContext, useContext, useState, useCallback, useEffect} from 'react';
import {AppState} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import {notificationsApi} from '../services/api';
import {useAuth} from './AuthContext';

type NotificationContextType = {
  unreadCount: number;
  increment: () => void;
  refresh: () => Promise<void>;
  resetCount: () => void;
};

const NotificationContext = createContext<NotificationContextType>({
  unreadCount: 0,
  increment: () => {},
  refresh: async () => {},
  resetCount: () => {},
});

export function NotificationProvider({children}: {children: React.ReactNode}) {
  const {isDriverLoggedIn} = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isDriverLoggedIn) return;
    try {
      const res = await notificationsApi.getHistory(1, 0);
      if (res?.data) {
        setUnreadCount(res.data.unread || 0);
      }
    } catch {
      // silent
    }
  }, [isDriverLoggedIn]);

  const increment = useCallback(() => {
    setUnreadCount(prev => prev + 1);
  }, []);

  const resetCount = useCallback(() => {
    setUnreadCount(0);
  }, []);

  // Fetch unread count on login
  useEffect(() => {
    if (isDriverLoggedIn) {
      refresh();
    } else {
      setUnreadCount(0);
    }
  }, [isDriverLoggedIn, refresh]);

  // Increment count on incoming push (foreground)
  useEffect(() => {
    if (!isDriverLoggedIn) return;
    const unsub = messaging().onMessage(() => {
      setUnreadCount(prev => prev + 1);
    });
    return unsub;
  }, [isDriverLoggedIn]);

  // Refresh count when app comes to foreground (may have received background pushes)
  useEffect(() => {
    if (!isDriverLoggedIn) return;
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => sub.remove();
  }, [isDriverLoggedIn, refresh]);

  return (
    <NotificationContext.Provider value={{unreadCount, increment, refresh, resetCount}}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
