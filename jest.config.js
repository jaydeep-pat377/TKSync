module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: [
    './jest.setup.js',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native(-.*)?|@react-native(-community)?/.*|@sentry/.*|@react-navigation/.*|@notifee/.*|@react-native-firebase/.*|@rnmapbox/.*)/)',
  ],
};
