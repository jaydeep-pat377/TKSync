// Global colors (shared across both themes)
const Global = {
  headerGreen: '#5e9c2a',
  headerGreen2: '#6BB130',
  green: '#2bb24c',
  blue: '#2f9fe0',
  gold: '#f4a823',
  red: '#c0392b',
  redSoft: '#d65745',
  yellow: '#f6d10b',
  teal: '#37c5a6',
  purple: '#8b6cff',
  orange: '#e8923a',
} as const;

export const Colors = {
  // Brand - Primary (Green)
  primary: Global.headerGreen,
  primaryDark: '#367000',
  primaryLight: Global.headerGreen2,
  primarySurface: '#F5F5F5',
  primaryBorder: '#E0E0E0',
  primaryMuted: '#EEEEEE',

  // Brand - Accent (Blue)
  accent: Global.blue,
  accentLight: '#3B82F6',
  accentBg: Global.blue,

  // Neutrals (Light mode)
  white: '#ffffff',       // --panel
  black: '#000000',
  background: '#eef1f5',  // --bg
  surface: '#f3f6f9',     // --inset
  border: '#e4e8ee',      // --line
  borderLight: '#eef1f5', // --hair
  divider: '#dbe1e9',     // --line2

  // Text (Light mode)
  textPrimary: '#1b2532',  // --text
  textSecondary: '#5f6b7b', // --muted
  textTertiary: '#6b7785', // --code
  textMuted: '#76828f',    // --label
  textPlaceholder: '#aab3bf', // --val-none
  textOnPrimary: '#FFFFFF',

  // Status
  success: Global.green,
  successDark: '#166534',
  successSurface: 'rgba(43,178,76,.14)', // --ok-bg
  warning: Global.gold,
  warningDark: '#92400E',
  warningSurface: '#FFFBEB',
  warningBorder: '#FCD34D',
  error: Global.red,
  errorSurface: 'rgba(192,57,43,.12)', // --no-bg

  // Specific UI
  highlight: Global.yellow,
  bannerBg: '#1b2532',
  signBtn: Global.headerGreen,
  disputeBtn: Global.red,
  linkBlue: '#1f6fc0',    // --link
  tabActive: Global.headerGreen,
  saveBtn: '#d6dde6',     // --btnB
  radioActive: '#E91E63',
  qrBg: '#FFFFFF',
  qrFg: '#000000',

  // Extra mappings
  page: '#dfe3e9',        // --page
  btn: '#f2f5f9',         // --btn
  btnBorder: '#d6dde6',   // --btnB
  pill: '#eef2f7',        // --pill
  pillBorder: '#d4dbe4',  // --pillB
  wait: '#c4ccd6',        // --wait
  waitText: '#9aa4b0',    // --waitT
  dash: '#c4ccd6',        // --dash
  kpi: '#1b2532',         // --kpi
  thBg: '#f1f4f8',        // --thBg
  partBg: 'rgba(232,146,58,.14)', // --part-bg
  valHas: '#2e8b3f',      // --val-has
  valMm: '#4f8a55',       // --val-mm
  valNone: '#aab3bf',     // --val-none
  doneLabel: '#3f7d49',   // --done-label

  // Overlay
  overlay06: 'rgba(255,255,255,0.06)',
  overlay08: 'rgba(255,255,255,0.08)',
  overlay10: 'rgba(255,255,255,0.10)',
  overlay15: 'rgba(255,255,255,0.15)',
  overlay20: 'rgba(255,255,255,0.20)',
  overlay25: 'rgba(255,255,255,0.25)',
  overlayDark: 'rgba(20,28,40,.45)', // --overlay
  overlayModal: 'rgba(20,28,40,.45)',
  overlayDropdown: 'rgba(20,28,40,.45)',
  overlay12: 'rgba(255,255,255,0.12)',
  textOnDark70: 'rgba(255,255,255,0.7)',
  textOnDark65: 'rgba(255,255,255,0.65)',
  textOnDark60: 'rgba(255,255,255,0.6)',
  textOnDark35: 'rgba(255,255,255,0.35)',
  textOnDark12: 'rgba(255,255,255,0.12)',
  shadowColor: '#000',
} as const;

export const DarkColors = {
  // Brand - Primary (Green)
  primary: Global.headerGreen,
  primaryDark: '#0a0e15',
  primaryLight: Global.headerGreen2,
  primarySurface: '#162200',
  primaryBorder: '#2E5A00',
  primaryMuted: '#1E2E10',

  // Brand - Accent (Blue)
  accent: Global.blue,
  accentLight: '#4aa6ec',
  accentBg: '#1A2D50',

  // Neutrals (Dark mode)
  white: '#2C2F33',       // --panel (dark gray)
  black: '#e8edf3',
  background: '#1E2126',  // --bg
  surface: '#252830',     // --inset
  border: '#3A3E45',      // --line
  borderLight: '#323640', // --hair
  divider: '#3E4350',     // --line2

  // Text (Dark mode)
  textPrimary: '#e8edf3',  // --text
  textSecondary: '#8a97a8', // --muted
  textTertiary: '#7f8c9b', // --code
  textMuted: '#7e8b9c',    // --label
  textPlaceholder: '#46535f', // --val-none
  textOnPrimary: '#FFFFFF',

  // Status
  success: Global.green,
  successDark: '#00E6AA',
  successSurface: 'rgba(43,178,76,.16)', // --ok-bg
  warning: Global.gold,
  warningDark: '#FFD54F',
  warningSurface: '#2A1F05',
  warningBorder: '#8A6A10',
  error: Global.redSoft,
  errorSurface: 'rgba(214,87,69,.16)', // --no-bg

  // Specific UI
  highlight: Global.yellow,
  bannerBg: '#0a0e15',
  signBtn: Global.green,
  disputeBtn: Global.redSoft,
  linkBlue: '#4aa6ec',    // --link
  tabActive: Global.green,
  saveBtn: '#233140',     // --btnB
  radioActive: '#FF6B9D',
  qrBg: '#0e141d',
  qrFg: '#e8edf3',

  // Extra mappings
  page: '#05080c',        // --page
  btn: '#0f1822',         // --btn
  btnBorder: '#233140',   // --btnB
  pill: '#0d1620',        // --pill
  pillBorder: '#25333f',  // --pillB
  wait: '#2c3a49',        // --wait
  waitText: '#3a4756',    // --waitT
  dash: '#2c3a49',        // --dash
  kpi: '#f1f5f9',         // --kpi
  thBg: '#0b1119',        // --thBg
  partBg: 'rgba(232,146,58,.16)', // --part-bg
  valHas: '#5fb85f',      // --val-has
  valMm: '#7fb88a',       // --val-mm
  valNone: '#46535f',     // --val-none
  doneLabel: '#7fb88a',   // --done-label

  // Overlay
  overlay06: 'rgba(255,255,255,0.04)',
  overlay08: 'rgba(255,255,255,0.06)',
  overlay10: 'rgba(255,255,255,0.08)',
  overlay12: 'rgba(255,255,255,0.10)',
  overlay15: 'rgba(255,255,255,0.12)',
  overlay20: 'rgba(255,255,255,0.16)',
  overlay25: 'rgba(255,255,255,0.20)',
  overlayDark: 'rgba(0,0,0,.6)',  // --overlay
  overlayModal: 'rgba(0,0,0,.6)',
  overlayDropdown: 'rgba(0,0,0,.6)',
  textOnDark70: 'rgba(255,255,255,0.7)',
  textOnDark65: 'rgba(255,255,255,0.6)',
  textOnDark60: 'rgba(255,255,255,0.5)',
  textOnDark35: 'rgba(255,255,255,0.3)',
  textOnDark12: 'rgba(255,255,255,0.08)',
  shadowColor: '#000',
} as const;
