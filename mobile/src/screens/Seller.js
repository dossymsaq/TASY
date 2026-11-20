import React from 'react';
import { Linking, Share, View } from 'react-native';
import { API_URL, api, money } from '../api';
import { Empty, OrderCard, Scroll, alertError, confirm, useLoad } from '../common';
import { useNav } from '../nav';
import { Button, Card, Chips, Err, H, Input, T, s } from '../ui';

const trackLink = (o) => `${API_URL}/t/${o.code}`;
export async function shareOrder(o, user, cfg) {
  const text = `Здравствуйте! Ваш заказ из «${user.shop_name}» доставит курьер Жеткіз 750. Оплата доставки ${money(cfg.price_buyer)} и отслеживание: ${trackLink(o)}`;
  await Share.share({ message: text });
}
const whatsapp = (o, user, cfg) => Linking.openURL(`https://wa.me/${o.buyer_phone}?text=${encodeURIComponent(`Здравствуйте! Ваш заказ из «${user.shop_name}» доставит курьер Жеткіз 750. Оплата доставки ${money(cfg.price_buyer)} и отслеживание: ${trackLink(o)}`)}`);

export function NewOrder() {
  const { cfg, user, push } = useNav();
  const empty = { buyer_name: '', buyer_phone: '', address: '', district: '', weight_kg: '', item_desc: '', comment: '', pickup_address: user.pickup_address || '' };
  const [f, setF] = React.useState(empty);
  const [err, setErr] = React.useState('');
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const submit = async () => {
    setErr('');
    try {
      const { order } = await api('POST', '/seller/orders', { ...f, weight_kg: Number(String(f.weight_kg).replace(',', '.')), pay_now: true });
      setF(empty);
      push('shared', { order, title: 'Заказ создан' });
    } catch (e) { setErr(e.message); }
  };
  return (
    <Scroll>
      <Card style={{ gap: 12 }}>
        <H>Новая доставка</H>
        <T muted size={14}>Для вас — {money(cfg.price_seller)}. Покупатель платит {money(cfg.price_buyer)}. До {cfg.max_weight_kg} кг, только {cfg.city}.</T>
        <Input label="Имя покупателя" value={f.buyer_name} onChangeText={set('buyer_name')} />
        <Input label="Телефон покупателя" value={f.buyer_phone} onChangeText={set('buyer_phone')} keyboardType="phone-pad" placeholder="+7 7XX XXX XX XX" />
        <Input label="Адрес доставки" value={f.address} onChangeText={set('address')} placeholder="Улица, дом, подъезд, квартира" />
        <T bold size={14}>Район</T>
        <Chips value={f.district} onChange={set('district')} options={cfg.districts.map((d) => [d, d])} />
        <Input label={`Вес, кг (до ${cfg.max_weight_kg})`} value={f.weight_kg} onChangeText={set('weight_kg')} keyboardType="decimal-pad" />
        <Input label="Что везём" value={f.item_desc} onChangeText={set('item_desc')} />
        <Input label="Адрес забора" value={f.pickup_address} onChangeText={set('pickup_address')} />
        <Input label="Комментарий курьеру" value={f.comment} onChangeText={set('comment')} multiline />
        <Err>{err}</Err>
        <Button kind="sun" title={`Создать и оплатить ${money(cfg.price_seller)}`} onPress={submit} />
      </Card>
    </Scroll>
  );
}

export function Shared({ order }) {
  const { user, cfg } = useNav();
  return (
    <Scroll>
      <Card style={{ gap: 10 }}>
        <H>Отправьте ссылку покупателю</H>
        <T muted>По ссылке покупатель оплатит {money(cfg.price_buyer)}, увидит статус и код получения.</T>
        <T selectable bold>{trackLink(order)}</T>
        <Button title="WhatsApp" onPress={() => whatsapp(order, user, cfg)} />
        <Button kind="ghost" title="Поделиться…" onPress={() => shareOrder(order, user, cfg)} />
      </Card>
      <OrderCard o={order} />
    </Scroll>
  );
}

export function SellerOrders() {
  const { user, cfg } = useNav();
  const { data, error, refreshing, load } = useLoad(async () => {
    const [o, st] = await Promise.all([api('GET', '/seller/orders'), api('GET', '/seller/stats')]);
    return { ...o, st };
  });
  const act = (fn) => async () => { try { await fn(); load(); } catch (e) { alertError(e); } };
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {data ? <View style={s.row}>
        {[[data.st.total || 0, 'всего'], [data.st.active || 0, 'в работе'], [data.st.delivered || 0, 'доставлено'], [money(data.st.spent), 'оплачено']].map(([v, l]) =>
          <Card key={l} style={{ flexGrow: 1, minWidth: 140 }}><T bold size={22}>{v}</T><T muted size={13}>{l}</T></Card>)}
      </View> : null}
      {data && !data.orders.length ? <Empty>Заказов пока нет</Empty> : null}
      {data?.orders.map((o) => (
        <OrderCard key={o.id} o={o}>
          {!o.seller_paid && o.status === 'new' ? <Button small kind="sun" title={`Оплатить ${money(cfg.price_seller)}`} onPress={act(() => api('POST', `/seller/orders/${o.id}/pay`))} /> : null}
          {o.status !== 'cancelled' ? <Button small kind="ghost" title="Ссылка покупателю" onPress={() => shareOrder(o, user, cfg)} /> : null}
          {['new', 'ready'].includes(o.status) ? <Button small kind="ghost" title="Отменить" onPress={act(async () => {
            if (await confirm('Отменить заказ?', 'Оплата вернётся')) await api('POST', `/seller/orders/${o.id}/cancel`);
          })} /> : null}
        </OrderCard>
      ))}
    </Scroll>
  );
}
