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
  const [code, setCode] = React.useState('');
  const [cash, setCash] = React.useState(false);
  const [err, setErr] = React.useState('');
  const submit = async () => {
    setErr('');
    try { await api('POST', `/courier/orders/${order.id}/deliver`, { confirm_code: code, cash_received: cash }); onDone?.(); pop(); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Scroll>
      <Card style={{ gap: 12 }}>
        <H>Заказ {order.code}</H>
        <T>{order.buyer_name} · {order.address}</T>
        <Input label="Код получения от покупателя" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={4} autoFocus style={{ fontSize: 28, letterSpacing: 8, textAlign: 'center' }} />
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
  const { data, error, refreshing, load } = useCourier();
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {data ? <Card><T bold size={24}>{data.done.length}</T><T muted>последних доставок</T></Card> : null}
      {data?.done.map((o) => <OrderCard key={o.id} o={o} />)}
    </Scroll>
  );
}
