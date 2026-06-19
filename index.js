/**
 * @format
 */

import './src/i18n';
import { AppRegistry } from 'react-native';
import notifee from '@notifee/react-native';
import { setupBackgroundHandler } from './src/services/notifications';
import App from './App';
import { name as appName } from './app.json';

setupBackgroundHandler();

// Required by notifee for background notification tap handling
notifee.onBackgroundEvent(async () => {});

AppRegistry.registerComponent(appName, () => App);
