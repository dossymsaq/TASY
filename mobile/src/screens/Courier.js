import React from 'react';
import { Linking, Switch, View } from 'react-native';
import { api, money } from '../api';
import { Empty, OrderCard, Scroll, alertError, useLoad } from '../common';
import { useNav } from '../nav';
import { Button, Card, Err, H, Input, T, s } from '../ui';

function useCourier() { return useLoad(() => api('GET', '/courier/orders')); }

export function Available() {
  const { data, error, refreshing, load } = useCourier();
  const take = (o) => async () => { try { await api('POST', `/courier/orders/${o.id}/take`); load(); } catch (e) { alertError(e); load(); } };
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {data && !data.available.length ? <Empty>Свободных заказов нет. Потяните вниз, чтобы обновить.</Empty> : null}
      {data?.available.map((o) => <OrderCard key={o.id} o={o}><Button small title="Взять заказ" onPress={take(o)} /></OrderCard>)}
    </Scroll>
  );
}

export function Mine() {
  const { push } = useNav();
  const { data, error, refreshing, load } = useCourier();
  const pickup = (o) => async () => { try { await api('POST', `/courier/orders/${o.id}/pickup`); load(); } catch (e) { alertError(e); } };
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {data && !data.mine.length ? <Empty>Активных доставок нет</Empty> : null}
      {data?.mine.map((o) => (
        <OrderCard key={o.id} o={o}>
          {o.status === 'assigned' ? <>
            <Button small kind="ghost" title="Позвонить продавцу" onPress={() => Linking.openURL('tel:+' + o.seller_phone)} />
            <Button small title="Забрал у продавца" onPress={pickup(o)} />
          </> : null}
          {o.status === 'picked_up' ? <Button small kind="sun" title="Вручить" onPress={() => push('deliver', { order: o, title: 'Вручение', onDone: load })} /> : null}
          <Button small kind="ghost" title="Маршрут 2ГИС" onPress={() => Linking.openURL(`https://2gis.kz/astana/search/${encodeURIComponent(o.address)}`)} />
        </OrderCard>
      ))}
    </Scroll>
  );
}

export function Deliver({ order, onDone }) {
  const { cfg, pop } = useNav();
  const [cash, setCash] = React.useState(false);
  const [err, setErr] = React.useState('');
  const submit = async () => {
    setErr('');
    try { await api('POST', `/courier/orders/${order.id}/deliver`, { cash_received: cash }); onDone?.(); pop(); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Scroll>
      <Card style={{ gap: 12 }}>
        <H>Заказ {order.code}</H>
        <T>{order.buyer_name} · {order.address}</T>
        <T muted size={14}>Отдайте посылку лично получателю — имя и телефон указаны в заказе.</T>
        {order.buyer_paid ? <T bold color="#1f9d55">Покупатель оплатил онлайн</T> : (
          <View style={s.between}><T style={{ flex: 1 }}>Получил {money(cfg.price_buyer)} наличными</T><Switch value={cash} onValueChange={setCash} /></View>
        )}
        <Err>{err}</Err>
        <Button kind="sun" title="Подтвердить вручение" onPress={submit} />
      </Card>
    </Scroll>
  );
}

export function Done() {
  const { data, error, refreshing, load } = useLoad(async () => {
    const [o, cash] = await Promise.all([api('GET', '/courier/orders'), api('GET', '/courier/cash')]);
    return { ...o, cash };
  });
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {data ? <Card>
        <T bold size={24}>{money(data.cash.on_hand)}</T><T muted>наличные на руках — сдайте администратору</T>
        {data.cash.items.map((i) => <T key={i.id} size={13} muted>{i.code} · {i.buyer_name} · {money(i.amount)}</T>)}
        {data.cash.handovers[0] ? <T size={13} muted>Последняя сдача: {money(data.cash.handovers[0].amount)}</T> : null}
      </Card> : null}
      {data ? <Card><T bold size={24}>{data.done.length}</T><T muted>последних доставок</T></Card> : null}
      {data?.done.map((o) => <OrderCard key={o.id} o={o} />)}
    </Scroll>
  );
}
