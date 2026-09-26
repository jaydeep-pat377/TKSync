module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Warn, not error. Each of these is a judgement call about a specific
    // screen's render behaviour — adding a dep can introduce an infinite loop —
    // so they get reviewed one at a time, not silenced in bulk to make CI pass.
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    {
      // jest.setup.js runs in the Jest environment but lives outside __tests__,
      // so the preset's jest override never matched it — 94 bogus `'jest' is
      // not defined` errors that made `npm run lint` useless as a gate.
      files: ['jest.setup.js', 'jest.config.js', '__tests__/**'],
      env: {jest: true},
    },
  ],
};
