import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.remsfal.app',
  appName: 'REMSFAL',
  webDir: 'dist',
  plugins: {PushNotifications: {presentationOptions: ['banner', 'list', 'sound', 'badge'],},},
  server: {
    url: 'http://localhost:5173',
    cleartext: true,
  },
};

export default config;
