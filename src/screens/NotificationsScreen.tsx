import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  useWindowDimensions,
  Animated,
  Easing,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTheme} from '../contexts/ThemeContext';
import {ms, wp} from '../utils/responsive';
import {notificationsApi} from '../services/api';
import type {DriverNotification} from '../services/api';
import {useFontScaleRefresh} from '../contexts/FontSizeContext';
import {useNotifications} from '../contexts/NotificationContext';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export default function NotificationsScreen({navigation}: Props) {
  useFontScaleRefresh();
  const {c, isDark} = useTheme();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const isLandscape = width > height;

  const {resetCount: resetBadge, refresh: refreshBadge} = useNotifications();
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Spin animation for refresh icon
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (refreshing) {
      spinAnim.setValue(0);
      spinRef.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      spinRef.current.start();
    } else {
      spinRef.current?.stop();
      spinAnim.setValue(0);
    }
    return () => { spinRef.current?.stop(); };
  }, [refreshing, spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationsApi.getHistory(50, 0);
      if (res?.data) {
        setNotifications(res.data.notifications || []);
        setUnreadCount(res.data.unread || 0);
      }
    } catch (e) {
      console.warn('Failed to fetch notifications:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications(prev => prev.map(n => ({...n, read: true})));
      setUnreadCount(0);
      resetBadge();
    } catch (e) {
      console.warn('Failed to mark all read:', e);
    }
  }, [resetBadge]);

  const handlePress = useCallback(async (item: DriverNotification) => {
    if (!item.read) {
      try {
        await notificationsApi.markRead(item.id);
        setNotifications(prev =>
          prev.map(n => (n.id === item.id ? {...n, read: true} : n)),
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
        refreshBadge();
      } catch (e) {
        console.warn('Failed to mark read:', e);
      }
    }
  }, [refreshBadge]);

  const renderItem = useCallback(
    ({item}: {item: DriverNotification}) => {
      const unread = !item.read;
      return (
        <TouchableOpacity
          onPress={() => handlePress(item)}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row',
            backgroundColor: unread
              ? isDark ? 'rgba(47,159,224,0.08)' : 'rgba(47,159,224,0.06)'
              : 'transparent',
            borderLeftWidth: 3,
            borderLeftColor: unread ? c.accent : 'transparent',
            paddingHorizontal: isLandscape ? 20 : 16,
            paddingVertical: isLandscape ? 10 : 14,
            borderBottomWidth: 0.5,
            borderBottomColor: c.border,
            gap: 12,
          }}>
          {/* Icon */}
          <View
            style={{
              width: isLandscape ? 34 : 38,
              height: isLandscape ? 34 : 38,
              borderRadius: isLandscape ? 17 : 19,
              backgroundColor: unread
                ? c.accent
                : isDark ? c.border : c.primaryMuted,
              justifyContent: 'center',
              alignItems: 'center',
              marginTop: 2,
            }}>
            <Icon
              name="notifications"
              size={isLandscape ? 15 : 17}
              color={unread ? '#fff' : c.textSecondary}
            />
          </View>

          {/* Content */}
          <View style={{flex: 1, gap: 3}}>
            {/* Title row */}
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'}}>
              <Text
                style={{
                  fontSize: ms(isLandscape ? 12 : 13),
                  fontWeight: unread ? '800' : '500',
                  color: c.textPrimary,
                  flex: 1,
                  fontFamily: MONO,
                }}
                numberOfLines={1}>
                {item.title}
              </Text>
              <Text
                style={{
                  fontSize: ms(isLandscape ? 8 : 9),
                  color: c.textMuted,
                  fontFamily: MONO,
                  marginLeft: 8,
                  marginTop: 2,
                }}>
                {timeAgo(item.created_at)}
              </Text>
            </View>

            {/* Message */}
            <Text
              style={{
                fontSize: ms(isLandscape ? 11 : 12),
                color: unread ? c.textPrimary : c.textSecondary,
                lineHeight: ms(isLandscape ? 16 : 18),
              }}
              numberOfLines={3}>
              {item.message}
            </Text>

            {/* Footer: sender + time */}
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2}}>
              {item.sender && (
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 3}}>
                  <Icon name="person" size={ms(9)} color={c.textMuted} />
                  <Text
                    style={{
                      fontSize: ms(isLandscape ? 8 : 9),
                      color: c.textMuted,
                      fontFamily: MONO,
                    }}>
                    {item.sender}
                  </Text>
                </View>
              )}
              {item.truck_code && (
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 3}}>
                  <Icon name="local-shipping" size={ms(9)} color={c.textMuted} />
                  <Text
                    style={{
                      fontSize: ms(isLandscape ? 8 : 9),
                      color: c.textMuted,
                      fontFamily: MONO,
                    }}>
                    Truck {item.truck_code}
                  </Text>
                </View>
              )}
              <Text
                style={{
                  fontSize: ms(isLandscape ? 8 : 9),
                  color: c.textPlaceholder,
                  fontFamily: MONO,
                }}>
                {formatTime(item.created_at)}
              </Text>
            </View>
          </View>

          {/* Unread dot */}
          {unread && (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: c.accent,
                alignSelf: 'center',
              }}
            />
          )}
        </TouchableOpacity>
      );
    },
    [c, isDark, isLandscape, handlePress],
  );

  return (
    <View style={{flex: 1, backgroundColor: c.primaryDark}}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + (isLandscape ? 4 : 10),
          paddingBottom: isLandscape ? 8 : 14,
          paddingHorizontal: Math.max(16, insets.left + 8),
          backgroundColor: c.primary,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 14}}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
            style={{
              width: isLandscape ? 30 : 34,
              height: isLandscape ? 30 : 34,
              borderRadius: isLandscape ? 15 : 17,
              backgroundColor: 'rgba(255,255,255,0.15)',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
            <Icon name="arrow-back" size={ms(isLandscape ? 16 : 18)} color="#fff" />
          </TouchableOpacity>
          <View>
            <Text
              style={{
                fontSize: ms(isLandscape ? 15 : 18),
                fontWeight: '900',
                color: '#fff',
                fontFamily: MONO,
                letterSpacing: 0.5,
              }}>
              NOTIFICATIONS
            </Text>
            <Text
              style={{
                fontSize: ms(isLandscape ? 9 : 10),
                color: 'rgba(255,255,255,0.7)',
                fontFamily: MONO,
                marginTop: 1,
              }}>
              {loading
                ? 'Loading...'
                : unreadCount > 0
                ? `${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}`
                : `${notifications.length} message${notifications.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
          {unreadCount > 0 && (
            <TouchableOpacity
              onPress={handleMarkAllRead}
              activeOpacity={0.7}
              style={{
                backgroundColor: 'rgba(255,255,255,0.15)',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 6,
                borderWidth: 0.5,
                borderColor: 'rgba(255,255,255,0.25)',
              }}>
              <Text
                style={{
                  fontSize: ms(isLandscape ? 9 : 10),
                  color: '#fff',
                  fontWeight: '700',
                  fontFamily: MONO,
                }}>
                MARK ALL READ
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={onRefresh}
            disabled={refreshing}
            activeOpacity={0.7}
            style={{
              height: isLandscape ? 28 : 32,
              borderRadius: 6,
              backgroundColor: refreshing
                ? 'rgba(255,255,255,0.25)'
                : 'rgba(255,255,255,0.15)',
              justifyContent: 'center',
              alignItems: 'center',
              flexDirection: 'row',
              paddingHorizontal: refreshing ? 12 : 10,
              gap: 5,
              borderWidth: 0.5,
              borderColor: 'rgba(255,255,255,0.25)',
            }}>
            <Animated.View style={{transform: [{rotate: spin}]}}>
              <Icon name="autorenew" size={ms(isLandscape ? 14 : 16)} color="#fff" />
            </Animated.View>
            {refreshing && (
              <Text style={{fontSize: ms(isLandscape ? 8 : 9), color: '#fff', fontWeight: '700', fontFamily: MONO}}>
                SYNCING
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <View style={{flex: 1, backgroundColor: c.background}}>
        {loading ? (
          <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
            <ActivityIndicator size="large" color={c.primary} />
            <Text
              style={{
                fontSize: ms(11),
                color: c.textSecondary,
                marginTop: 12,
                fontFamily: MONO,
              }}>
              Loading notifications...
            </Text>
          </View>
        ) : (
          <FlatList
            data={notifications}
            renderItem={renderItem}
            keyExtractor={item => String(item.id)}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={c.primary}
                colors={[c.primary]}
              />
            }
            ListEmptyComponent={
              <View
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingTop: isLandscape ? 40 : 100,
                  paddingHorizontal: 40,
                }}>
                <View
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 36,
                    backgroundColor: isDark ? c.surface : c.primaryMuted,
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginBottom: 16,
                  }}>
                  <Icon name="notifications" size={32} color={c.textPlaceholder} />
                </View>
                <Text
                  style={{
                    fontSize: ms(15),
                    fontWeight: '700',
                    color: c.textPrimary,
                    fontFamily: MONO,
                    marginBottom: 6,
                  }}>
                  No notifications yet
                </Text>
                <Text
                  style={{
                    fontSize: ms(11),
                    color: c.textSecondary,
                    fontFamily: MONO,
                    textAlign: 'center',
                    lineHeight: ms(17),
                  }}>
                  Messages from dispatch will appear here
                </Text>
              </View>
            }
            contentContainerStyle={{
              paddingBottom: insets.bottom + 16,
              flexGrow: notifications.length === 0 ? 1 : undefined,
            }}
          />
        )}
      </View>
    </View>
  );
}
