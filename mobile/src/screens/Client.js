import React from 'react';
import { api, money, openPayment } from '../api';
import { Empty, OrderCard, Scroll, alertError, useLoad } from '../common';
import { useNav } from '../nav';
import { Button } from '../ui';

export function ClientOrders() {
  const { cfg } = useNav();
  const { data, error, refreshing, load } = useLoad(() => api('GET', '/client/orders'));
  const pay = (o) => async () => { try { await openPayment((await api('POST', `/track/${o.code}/pay`)).pay_url); } catch (e) { alertError(e); } };
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {data && !data.orders.length ? <Empty>Посылок на ваш номер пока нет. Когда продавец оформит доставку, она появится здесь.</Empty> : null}
      {data?.orders.map((o) => (
        <OrderCard key={o.id} o={o}>
          {cfg.online_payments !== false && !o.buyer_paid && o.status !== 'cancelled' ? <Button small kind="sun" title={`Оплатить доставку ${money(cfg.price_buyer)}`} onPress={pay(o)} /> : null}
        </OrderCard>
      ))}
    </Scroll>
  );
}
