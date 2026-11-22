import * as SecureStore from 'expo-secure-store';
import { Alert, Linking, Platform } from 'react-native';

// Адрес сервера. Задайте EXPO_PUBLIC_API_URL, например: EXPO_PUBLIC_API_URL=https://jetkiz750.kz
// EXPO_PUBLIC_API_URL=demo — демо-режим: сервер работает внутри приложения, интернет не нужен.
const RAW_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
export const DEMO = RAW_URL === 'demo';
export const API_URL = DEMO ? 'https://jetkiz750.kz' : RAW_URL.replace(/\/$/, '');
// Сайт: ссылки для покупателя, оферта, политика
export const SITE_URL = API_URL;
const demo = DEMO ? require('./demo') : null;

let token = null;
const KEY = 'jt_token';

export async function loadToken() {
  try { token = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY); }
  catch { token = null; }
  return token;
}
export async function saveToken(t) {
  token = t;
  try {
    if (Platform.OS === 'web') t ? globalThis.localStorage?.setItem(KEY, t) : globalThis.localStorage?.removeItem(KEY);
    else t ? await SecureStore.setItemAsync(KEY, t) : await SecureStore.deleteItemAsync(KEY);
  } catch {}
}

export async function api(method, path, body) {
  if (DEMO) {
    const r = await demo.demoBackend().request(method, path, body, token);
    if (r.status >= 400) { const e = new Error(r.data.error || 'Ошибка'); e.status = r.status; throw e; }
    return r.data;
  }
  let res;
  try {
    res = await fetch(API_URL + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error('Нет связи с сервером'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Ошибка'); e.status = res.status; throw e; }
  return data;
}

export const money = (n) => Number(n || 0).toLocaleString('ru-RU') + ' ₸';
export const phone = (p) => (p ? `+${p[0]} ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7, 9)} ${p.slice(9)}` : '');
export const date = (s) => {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getDate())}.${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`;
};

// Открывает страницу оплаты банка в браузере. После оплаты пользователь возвращается в приложение,
// и экраны обновляются автоматически (см. useLoad в common.js).
export async function openPayment(payUrl) {
  if (DEMO) return demoPayment(payUrl);
  const url = payUrl.startsWith('/') ? API_URL + payUrl : payUrl;
  if (Platform.OS === 'web') { globalThis.location.href = url; return; }
  await Linking.openURL(url);
}

// Открыть страницу сайта (оферта, политика). В демо-режиме сайта ещё нет.
export function openSite(path) {
  if (DEMO) { Alert.alert('Демо-версия', 'Документы будут доступны на сайте после запуска сервиса.'); return; }
  Linking.openURL(SITE_URL + path);
}

// Демо: вместо страницы банка — окно с тестовой оплатой
async function demoPayment(payUrl) {
  const invoice = payUrl.split('/').pop();
  const info = await demo.demoBackend().payInfo(invoice);
  const choose = await new Promise((resolve) => Alert.alert(
    'Тестовая оплата',
    `${money(info?.amount)} · доставка ${info?.code}\nДемо-режим: деньги не списываются.`,
    [{ text: 'Отказаться', style: 'cancel', onPress: () => resolve('fail') }, { text: 'Оплатить', onPress: () => resolve('ok') }],
    { cancelable: true, onDismiss: () => resolve('fail') },
  ));
  await api('POST', '/payments/callback/mock', { invoice, result: choose });
  if (choose === 'ok') Alert.alert('Оплачено', 'Тестовая оплата прошла.');
}
