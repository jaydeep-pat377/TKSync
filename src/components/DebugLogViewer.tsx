/**
 * Floating in-app log viewer — shows console.log/warn/error in a draggable overlay.
 * Works in release builds. Tap the floating button to open/close.
 */
import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  PanResponder,
  Clipboard,
  Platform,
} from 'react-native';
import {logCapture, type LogEntry} from '../utils/logCapture';

const LEVEL_COLORS: Record<string, string> = {
  log: '#CCCCCC',
  info: '#64B5F6',
  warn: '#FFB74D',
  error: '#EF5350',
};

const LEVEL_BG: Record<string, string> = {
  log: 'transparent',
  info: 'rgba(100,181,246,0.1)',
  warn: 'rgba(255,183,77,0.15)',
  error: 'rgba(239,83,80,0.15)',
};

export function DebugLogViewer() {
  const [visible, setVisible] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Floating button position
  const [btnPos, setBtnPos] = useState({x: Dimensions.get('window').width - 60, y: 100});
  const btnPosRef = useRef(btnPos);
  btnPosRef.current = btnPos;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        setBtnPos({
          x: Math.max(0, Math.min(btnPosRef.current.x + g.dx, Dimensions.get('window').width - 50)),
          y: Math.max(0, Math.min(btnPosRef.current.y + g.dy, Dimensions.get('window').height - 50)),
        });
      },
      onPanResponderRelease: (_, g) => {
        // If barely moved, treat as tap
        if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10) {
          setVisible(v => !v);
        }
        btnPosRef.current = btnPos;
      },
    }),
  ).current;

  useEffect(() => {
    const unsub = logCapture.subscribe(() => {
      setLogs([...logCapture.getLogs()]);
    });
    setLogs([...logCapture.getLogs()]);
    return unsub;
  }, []);

  useEffect(() => {
    if (autoScroll && visible && logs.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({animated: false}), 50);
    }
  }, [logs.length, visible, autoScroll]);

  const filteredLogs = filter ? logs.filter(l => l.level === filter) : logs;

  const copyAll = useCallback(() => {
    const text = filteredLogs
      .map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
      .join('\n');
    Clipboard.setString(text);
  }, [filteredLogs]);

  const renderItem = useCallback(({item}: {item: LogEntry}) => (
    <TouchableOpacity
      onLongPress={() => Clipboard.setString(`[${item.timestamp}] ${item.message}`)}
      activeOpacity={0.7}
      style={[styles.logRow, {backgroundColor: LEVEL_BG[item.level]}]}
    >
      <Text style={[styles.logTime, {color: LEVEL_COLORS[item.level]}]}>
        {item.timestamp}
      </Text>
      <Text style={[styles.logMsg, {color: LEVEL_COLORS[item.level]}]} numberOfLines={6}>
        {item.message}
      </Text>
    </TouchableOpacity>
  ), []);

  const keyExtractor = useCallback((item: LogEntry) => String(item.id), []);

  return (
    <>
      {/* Floating debug button */}
      <View
        {...panResponder.panHandlers}
        style={[styles.fab, {left: btnPos.x, top: btnPos.y}]}
      >
        <Text style={styles.fabText}>
          {visible ? 'X' : 'D'}
        </Text>
      </View>

      {/* Log panel */}
      {visible && (
        <View style={styles.panel}>
          {/* Toolbar */}
          <View style={styles.toolbar}>
            <Text style={styles.title}>Debug Logs ({filteredLogs.length})</Text>
            <View style={styles.toolbarActions}>
              <TouchableOpacity onPress={copyAll} style={styles.toolBtn}>
                <Text style={styles.toolBtnText}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => logCapture.clear()} style={styles.toolBtn}>
                <Text style={styles.toolBtnText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAutoScroll(a => !a)} style={styles.toolBtn}>
                <Text style={[styles.toolBtnText, autoScroll && {color: '#4CAF50'}]}>
                  {autoScroll ? 'Auto' : 'Manual'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Filter tabs */}
          <View style={styles.filterRow}>
            {[null, 'log', 'info', 'warn', 'error'].map(level => (
              <TouchableOpacity
                key={level || 'all'}
                onPress={() => setFilter(level)}
                style={[styles.filterBtn, filter === level && styles.filterBtnActive]}
              >
                <Text style={[
                  styles.filterBtnText,
                  level ? {color: LEVEL_COLORS[level]} : null,
                  filter === level && styles.filterBtnTextActive,
                ]}>
                  {level ? level.toUpperCase() : 'ALL'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Log list */}
          <FlatList
            ref={flatListRef}
            data={filteredLogs}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            style={styles.list}
            initialNumToRender={30}
            maxToRenderPerBatch={20}
            windowSize={10}
            onScrollBeginDrag={() => setAutoScroll(false)}
          />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(33,150,243,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 10,
  },
  fabText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: Dimensions.get('window').height * 0.45,
    backgroundColor: 'rgba(18, 18, 18, 0.95)',
    zIndex: 9998,
    elevation: 9,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  title: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  toolbarActions: {
    flexDirection: 'row',
    gap: 8,
  },
  toolBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 6,
  },
  toolBtnText: {
    color: '#AAA',
    fontSize: 12,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 6,
    gap: 6,
  },
  filterBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  filterBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  filterBtnText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '500',
  },
  filterBtnTextActive: {
    fontWeight: '700',
  },
  list: {
    flex: 1,
    paddingHorizontal: 8,
  },
  logRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  logTime: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    width: 85,
    marginRight: 6,
  },
  logMsg: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
  },
});
