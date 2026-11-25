import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lifeos.app',
  appName: 'LifeinOne',
  webDir: 'dist',
  server: {
    hostname: 'excellent-engine-48f9p.firebaseapp.com',
    androidScheme: 'https',
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#059669',
    },
  },
};

export default config;
