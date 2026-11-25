import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lifeos.app',
  appName: 'LifeinOne',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      iconColor: '#059669',
    },
  },
};

export default config;
