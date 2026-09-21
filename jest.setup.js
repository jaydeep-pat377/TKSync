// Mock native modules that don't exist in the Jest environment

jest.mock('react-native-mmkv', () => ({
  createMMKV: jest.fn(() => ({
    getString: jest.fn(),
    set: jest.fn(),
    setString: jest.fn(),
    getBoolean: jest.fn(),
    setBoolean: jest.fn(),
    getNumber: jest.fn(),
    setNumber: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    contains: jest.fn(),
    clearAll: jest.fn(),
    getAllKeys: jest.fn(() => []),
  })),
}));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: jest.fn((component) => component),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  addBreadcrumb: jest.fn(),
  withScope: jest.fn((cb) => cb({ setExtra: jest.fn(), setExtras: jest.fn(), setTag: jest.fn(), setLevel: jest.fn() })),
  ReactNavigationInstrumentation: jest.fn(),
  ReactNativeTracing: jest.fn(),
}));

jest.mock('@react-native-firebase/app', () => ({}));

jest.mock('@react-native-firebase/messaging', () => () => ({
  getToken: jest.fn(() => Promise.resolve('mock-token')),
  onMessage: jest.fn(),
  onNotificationOpenedApp: jest.fn(),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
  requestPermission: jest.fn(() => Promise.resolve(1)),
}));

jest.mock('@notifee/react-native', () => ({
  displayNotification: jest.fn(),
  createChannel: jest.fn(),
  onBackgroundEvent: jest.fn(),
  onForegroundEvent: jest.fn(),
  AndroidImportance: { HIGH: 4 },
  EventType: { DISMISSED: 0, PRESS: 1 },
  AndroidCategory: {},
  AndroidForegroundServiceType: {},
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() => Promise.resolve({ isConnected: true })),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }) => children,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
  createNavigationContainerRef: jest.fn(() => ({ current: null })),
  DefaultTheme: { colors: { background: '#fff' } },
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }) => children,
    Screen: ({ children }) => children,
  }),
}));

jest.mock('@rnmapbox/maps', () => ({
  MapView: 'MapView',
  Camera: 'Camera',
  ShapeSource: 'ShapeSource',
  LineLayer: 'LineLayer',
  PointAnnotation: 'PointAnnotation',
  MarkerView: 'MarkerView',
  setAccessToken: jest.fn(),
  default: { setAccessToken: jest.fn() },
}));

jest.mock('react-native-config', () => ({
  Config: {
    API_URL: 'http://localhost',
    MQTT_URL: 'mqtt://localhost',
    MAPBOX_ACCESS_TOKEN: 'mock-token',
  },
  default: {
    API_URL: 'http://localhost',
    MQTT_URL: 'mqtt://localhost',
    MAPBOX_ACCESS_TOKEN: 'mock-token',
  },
}));

jest.mock('react-native-qrcode-svg', () => 'QRCode');

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Svg: 'Svg',
  Path: 'Path',
  Circle: 'Circle',
  Rect: 'Rect',
  G: 'G',
  ClipPath: 'ClipPath',
  Defs: 'Defs',
  Ellipse: 'Ellipse',
  Line: 'Line',
  LinearGradient: 'LinearGradient',
  Stop: 'Stop',
}));

jest.mock('react-native-geolocation-service', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: jest.fn(),
    watchPosition: jest.fn(),
    clearWatch: jest.fn(),
    stopObserving: jest.fn(),
  },
}));

jest.mock('react-native-sensors', () => ({
  orientation: { subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })) },
  accelerometer: { subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })) },
  SensorTypes: { orientation: 'orientation', accelerometer: 'accelerometer' },
  setUpdateIntervalForType: jest.fn(),
}));

jest.mock('react-native-vector-icons/MaterialIcons', () => 'MaterialIcons');

jest.mock('mqtt', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(() => ({
      on: jest.fn(),
      end: jest.fn(),
      subscribe: jest.fn(),
      publish: jest.fn(),
      connected: false,
    })),
  },
  connect: jest.fn(),
}));

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getVersion: jest.fn(() => '1.0.0'),
    getBuildNumber: jest.fn(() => '1'),
    getUniqueId: jest.fn(() => Promise.resolve('mock-id')),
    getDeviceName: jest.fn(() => Promise.resolve('Mock Device')),
  },
}));

jest.mock('react-native-localize', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en', countryCode: 'US' }]),
  findBestLanguageTag: jest.fn(() => ({ languageTag: 'en', isRTL: false })),
}));

jest.mock('react-native-signature-canvas', () => 'SignatureScreen');

jest.mock('i18next', () => {
  const i18n = {
    use: jest.fn(() => i18n),
    init: jest.fn(),
    t: jest.fn((key) => key),
    language: 'en',
    changeLanguage: jest.fn(),
  };
  return { __esModule: true, default: i18n };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', changeLanguage: jest.fn() } }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
