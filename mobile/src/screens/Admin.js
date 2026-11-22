import React from 'react';
import { Pressable, View } from 'react-native';
import { api, date, money, phone } from '../api';
import { Empty, OrderCard, Scroll, alertError, confirm, useLoad } from '../common';
import { useNav } from '../nav';
import { Button, Card, Chips, Err, H, Input, T, s, useTheme } from '../ui';

const ROLES = { seller: 'Продавец', client: 'Покупатель', courier: 'Курьер', admin: 'Администратор', support: 'Поддержка' };
const Stat = ({ v, l }) => <Card style={{ flexGrow: 1, minWidth: 150 }}><T bold size={22}>{v}</T><T muted size={13}>{l}</T></Card>;

export function Dashboard() {
  const th = useTheme();
  const { data: d, error, refreshing, load } = useLoad(() => api('GET', '/admin/stats'));
  const max = d ? Math.max(1, ...d.daily.map((x) => x.revenue)) : 1;
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {d ? <>
        <View style={s.row}>
          <Stat v={money(d.revenue)} l="выручка всего" />
          <Stat v={money(d.revenueToday)} l="выручка сегодня" />
          <Stat v={d.ordersToday} l="заказов сегодня" />
          <Stat v={d.deliveredToday} l="доставлено сегодня" />
          <Stat v={(d.byStatus.ready || 0) + (d.byStatus.assigned || 0) + (d.byStatus.picked_up || 0)} l="в работе" />
          <Stat v={d.byStatus.new || 0} l="ждут оплаты продавца" />
          <Stat v={d.openTickets} l="открытых обращений" />
          <Stat v={money(d.cashOnHands)} l="наличные на руках у курьеров" />
        </View>
        <Card>
          <H>Выручка за 14 дней</H>
          {d.daily.length ? <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 120 }}>
            {d.daily.map((x) => (
              <View key={x.day} style={{ flex: 1, maxWidth: 40, alignItems: 'center' }}>
                <View style={{ width: '100%', height: Math.max(2, (x.revenue / max) * 100), backgroundColor: th.brand, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                <T muted size={11}>{x.day.slice(8)}</T>
              </View>
            ))}
          </View> : <T muted>Пока нет оплат</T>}
        </Card>
        <Card><H>Пользователи</H>{Object.entries(ROLES).map(([k, v]) => <T key={k}>{v}: {d.users[k] || 0}</T>)}</Card>
      </> : null}
    </Scroll>
  );
}

export function Orders() {
  const { user, cfg, push } = useNav();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [query, setQuery] = React.useState({ q: '', status: '' });
  const { data, error, refreshing, load } = useLoad(() => {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString();
    return api('GET', '/admin/orders?' + qs);
  }, [query.q, query.status]);
  const isAdmin = user.role === 'admin';
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      <Input placeholder="Код, телефон, имя или адрес" value={q} onChangeText={setQ} onSubmitEditing={() => setQuery({ q, status })} returnKeyType="search" />
      <Chips value={status} onChange={(v) => { setStatus(v); setQuery({ q, status: v }); }} options={[['', 'Все'], ...Object.entries(cfg.statuses)]} />
      {data && !data.orders.length ? <Empty>Ничего не найдено</Empty> : null}
      {data?.orders.map((o) => (
        <OrderCard key={o.id} o={o}>
          {isAdmin && ['ready', 'assigned'].includes(o.status) ? <Button small title={o.courier ? 'Сменить курьера' : 'Назначить курьера'} onPress={() => push('assign', { order: o, title: 'Курьер для ' + o.code, onDone: load })} /> : null}
          {isAdmin && !['delivered', 'cancelled'].includes(o.status) ? <Button small kind="ghost" title="Отменить" onPress={async () => {
            if (!(await confirm('Отменить заказ?', 'Оплаты будут возвращены'))) return;
            try { await api('POST', `/admin/orders/${o.id}/cancel`, {}); load(); } catch (e) { alertError(e); }
          }} /> : null}
        </OrderCard>
      ))}
    </Scroll>
  );
}

export function Assign({ order, onDone }) {
  const { pop } = useNav();
  const { data, error } = useLoad(() => api('GET', '/admin/couriers'));
  const pick = (c) => async () => {
    try { await api('POST', `/admin/orders/${order.id}/assign`, { courier_id: c.id }); onDone?.(); pop(); } catch (e) { alertError(e); }
  };
  return (
    <Scroll error={error}>
      {data?.couriers.filter((c) => c.active).map((c) => (
        <Pressable key={c.id} onPress={pick(c)}>
          <Card style={order.courier_id === c.id ? { borderColor: '#00a3bf', borderWidth: 2 } : null}>
            <T bold>{c.name}</T><T muted size={14}>{phone(c.phone)} · в работе: {c.active_orders} · доставлено: {c.delivered}</T>
          </Card>
        </Pressable>
      ))}
    </Scroll>
  );
}

export function Couriers() {
  const { data, error, refreshing, load } = useLoad(() => api('GET', '/admin/couriers'));
  // Курьер сдал наличные, полученные от покупателей
  const handover = (c) => async () => {
    if (!(await confirm('Принять наличные?', `Вы получили ${money(c.cash_on_hand)} от курьера ${c.name}?`))) return;
    try { await api('POST', `/admin/cash/${c.id}/handover`, { amount: c.cash_on_hand }); load(); } catch (e) { alertError(e); load(); }
  };
  const total = data ? data.couriers.reduce((t, c) => t + c.cash_on_hand, 0) : 0;
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {data ? <Stat v={money(total)} l="наличные на руках у курьеров — ещё не сданы" /> : null}
      {data?.couriers.map((c) => (
        <Card key={c.id}>
          <View style={s.between}><T bold>{c.name}</T><T color={c.active ? '#1f9d55' : '#c27c00'} bold size={13}>{c.active ? 'активен' : 'заблокирован'}</T></View>
          <T muted size={14}>{phone(c.phone)} · в работе: {c.active_orders} · доставлено: {c.delivered}</T>
          <T size={14}>Наличные на руках: <T bold size={14}>{money(c.cash_on_hand)}</T></T>
          {c.cash_on_hand ? <Button small kind="sun" title={`Принял ${money(c.cash_on_hand)}`} onPress={handover(c)} /> : null}
        </Card>
      ))}
    </Scroll>
  );
}

export function Users() {
  const { user } = useNav();
  const { data, error, refreshing, load } = useLoad(() => api('GET', '/admin/users'));
  const [f, setF] = React.useState({ role: 'courier', name: '', phone: '', password: '' });
  const [err, setErr] = React.useState('');
  const add = async () => {
    setErr('');
    try { await api('POST', '/admin/users', f); setF({ ...f, name: '', phone: '', password: '' }); load(); } catch (e) { setErr(e.message); }
  };
  const toggle = (u) => async () => { try { await api('PATCH', `/admin/users/${u.id}`, { active: !u.active }); load(); } catch (e) { alertError(e); } };
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      <Card style={{ gap: 10 }}>
        <H>Добавить сотрудника</H>
        <Chips value={f.role} onChange={(v) => setF({ ...f, role: v })} options={[['courier', 'Курьер'], ['support', 'Поддержка'], ['admin', 'Админ']]} />
        <Input placeholder="Имя" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
        <Input placeholder="Телефон" keyboardType="phone-pad" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} />
        <Input placeholder="Пароль (мин. 6)" value={f.password} onChangeText={(v) => setF({ ...f, password: v })} />
        <Err>{err}</Err>
        <Button title="Добавить" onPress={add} />
      </Card>
      {data?.users.map((u) => (
        <Card key={u.id}>
          <View style={s.between}><T bold style={{ flex: 1 }}>{u.name}</T><T muted size={13}>{ROLES[u.role]}</T></View>
          <T muted size={14}>{phone(u.phone)}{u.shop_name ? ' · ' + u.shop_name : ''} · {date(u.created_at)}</T>
          {u.id !== user.id ? <Button small kind={u.active ? 'ghost' : 'brand'} title={u.active ? 'Заблокировать' : 'Разблокировать'} onPress={toggle(u)} style={{ alignSelf: 'flex-start', marginTop: 4 }} /> : null}
        </Card>
      ))}
    </Scroll>
  );
}
