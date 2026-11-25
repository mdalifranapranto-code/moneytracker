import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mymoney.ledger',
  appName: 'My Money',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
