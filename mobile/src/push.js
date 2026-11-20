// Push-уведомления (Expo). Работают только в сборке приложения на реальном телефоне.
// Для получения токена нужен projectId проекта Expo: выполните `npx eas-cli@latest init` в папке mobile —
// он запишет extra.eas.projectId в app.json.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

let currentToken = null;
export const pushToken = () => currentToken;

if (Platform.OS !== 'web') {
  // Показывать уведомление, даже когда приложение открыто
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

// Запрашивает разрешение, получает токен устройства и регистрирует его на сервере.
// Ошибки не мешают работе приложения — без push оно просто использует SMS.
export async function registerPush() {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Заказы', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250], lightColor: '#00a3bf',
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) { console.warn('Push: не задан extra.eas.projectId — выполните `npx eas-cli init`'); return null; }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api('POST', '/me/push-token', { token, platform: Platform.OS });
    currentToken = token;
    return token;
  } catch (e) {
    console.warn('Push не подключены:', e.message);
    return null;
  }
}

// Нажатие на уведомление: вызывает onOpen(data) — data содержит tab и order_code/ticket_id
export function onNotificationOpen(onOpen) {
  if (Platform.OS === 'web') return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((r) => onOpen(r.notification.request.content.data || {}));
  // Приложение было закрыто и открыто нажатием на уведомление
  Notifications.getLastNotificationResponseAsync().then((r) => { if (r) onOpen(r.notification.request.content.data || {}); }).catch(() => {});
  return () => sub.remove();
}
