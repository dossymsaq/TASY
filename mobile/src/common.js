import React from 'react';
import { Alert, AppState, Linking, RefreshControl, ScrollView, View } from 'react-native';
import { phone, date } from './api';
import { Badge, Card, Empty, T, s, useTheme } from './ui';

// Экран с прокруткой, «потяни для обновления» и загрузкой данных
export function useLoad(fn, deps = []) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);
  const load = React.useCallback(async () => {
    setRefreshing(true);
    try { setData(await fn()); setError(''); }
    catch (e) { setError(e.message); }
    finally { setRefreshing(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { load(); }, [load]);
  // Обновляем данные, когда пользователь возвращается в приложение (например, со страницы оплаты)
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
    return () => sub.remove();
  }, [load]);
  return { data, error, refreshing, load };
}
export function Scroll({ children, refreshing, onRefresh, error }) {
  return (
    <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
      {error ? <Card><T color="#d63c3c">{error}</T></Card> : null}
      {children}
    </ScrollView>
  );
}
export const alertError = (e) => Alert.alert('Ошибка', e.message);
export function confirm(title, message) {
  return new Promise((resolve) => Alert.alert(title, message, [
    { text: 'Нет', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Да', onPress: () => resolve(true) },
  ]));
}

export function OrderCard({ o, children }) {
  const t = useTheme();
  const [open, setOpen] = React.useState(false);
  const Paid = ({ ok }) => <T color={ok ? t.ok : t.warn} bold size={14}>{ok ? 'оплачено' : 'не оплачено'}</T>;
  return (
    <Card>
      <View style={s.between}><T bold style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>{o.code}</T><Badge status={o.status} text={o.status_text} /></View>
      <T bold>{o.buyer_name} · <T color={t.brand} onPress={() => Linking.openURL('tel:+' + o.buyer_phone)}>{phone(o.buyer_phone)}</T></T>
      <T size={14}>📦 {o.item_desc} · {o.weight_kg} кг</T>
      <T size={14}>🏬 {o.pickup_address}{o.seller ? ` (${o.seller.shop_name || o.seller.name})` : ''}</T>
      <T size={14}>📍 {o.address}, р-н {o.district}</T>
      {o.comment ? <T size={14} muted>💬 {o.comment}</T> : null}
      <View style={s.row}><T size={14}>Продавец:</T><Paid ok={o.seller_paid} /><T size={14}>Покупатель:</T><Paid ok={o.buyer_paid} /></View>
      {o.courier ? <T size={14}>🛵 {o.courier.name} · {phone(o.courier.phone)}</T> : null}
      <T size={14} color={t.brand} onPress={() => setOpen(!open)}>{open ? '▾ Скрыть историю' : '▸ История'}</T>
      {open ? o.events.map((e, i) => <T key={i} size={13} muted>{date(e.created_at)} — {e.note || e.status}</T>) : null}
      {children ? <View style={[s.row, { marginTop: 6 }]}>{children}</View> : null}
    </Card>
  );
}
export { Empty };
