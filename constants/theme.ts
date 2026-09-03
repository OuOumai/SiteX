/**
 * Earth/Geo Design System Theme Palette for SiteX
 * Construction-site monitoring app palette
 */

import { Platform } from 'react-native';

export const Palette = {
  primary: '#176B5B', // deep forest green
  primaryLight: '#208774',
  primaryDark: '#0F4A3F',
  secondary: '#2A9D8F', // teal
  secondaryLight: '#46C0B1',
  accent: '#F4A261', // construction orange
  accentLight: '#F7B783',
  background: '#F7F9F8', // subtle off-white/grey
  card: '#FFFFFF',
  text: '#17221F', // dark slate text
  textMuted: '#5C6E68',
  textLight: '#8C9E98',
  border: '#DCE4E1',
  inputBg: '#FFFFFF',
  inputBorder: '#C8D5D0',
  inputFocusBorder: '#176B5B',
  success: '#2E7D32',
  alert: '#D9534F',
  alertBg: '#FDF2F2',
  overlay: 'rgba(23, 34, 31, 0.4)',
};

export const Roles = [
  { id: 1, label: 'Admin', code: 'admin', description: 'System & workspace administration' },
  { id: 2, label: 'Project Manager', code: 'project_manager', description: 'Site operations & team management' },
  { id: 3, label: 'Field Agent', code: 'field_agent', description: 'On-site reporting & satellite data verification' },
  { id: 4, label: 'Client', code: 'client', description: 'Read-only view of progress & reports' },
];

export const Colors = {
  light: {
    text: Palette.text,
    background: Palette.background,
    tint: Palette.primary,
    icon: Palette.textMuted,
    tabIconDefault: Palette.textLight,
    tabIconSelected: Palette.primary,
  },
  dark: {
    text: '#F7F9F8',
    background: '#0F1715',
    tint: Palette.secondary,
    icon: '#8C9E98',
    tabIconDefault: '#5C6E68',
    tabIconSelected: Palette.secondary,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
