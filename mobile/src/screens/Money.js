import React from 'react';
import { View } from 'react-native';
import { api, date, money, phone } from '../api';
import { Scroll, useLoad } from '../common';
import { useNav } from '../nav';
import { Button, Card, Chips, Err, H, Input, T, s, useTheme } from '../ui';

const LEDGER = { earning: 'Доставка', cash: 'Наличные от покупателя', handover: 'Сдал наличные', payout: 'Выплата' };
const Stat = ({ v, l, color }) => <Card style={{ flexGrow: 1, minWidth: 150 }}><T bold size={22} color={color}>{v}</T><T muted size={13}>{l}</T></Card>;

function Ledger({ rows }) {
  const th = useTheme();
  if (!rows.length) return <Card><T muted>Операций пока нет</T></Card>;
  return (
    <Card style={{ gap: 0, paddingVertical: 4 }}>
      {rows.map((r, i) => (
        <View key={i} style={[s.between, { paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: th.line }]}>
          <View style={{ flex: 1 }}>
            <T size={14}>{LEDGER[r.type]}{r.order_code ? ` · ${r.order_code}` : ''}</T>
            <T muted size={12}>{date(r.created_at)}</T>
          </View>
          <T bold color={r.amount >= 0 ? th.ok : th.warn}>{r.amount >= 0 ? '+' : '−'}{money(Math.abs(r.amount))}</T>
        </View>
      ))}
    </Card>
  );
}

// Курьер: «Мои деньги»
export function Wallet() {
  const th = useTheme();
  const { data: b, error, refreshing, load } = useLoad(() => api('GET', '/courier/balance'));
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {b ? <>
        <View style={s.row}>
          <Stat v={money(b.earned_today)} l={`заработано сегодня · ${b.deliveries_today} дост.`} />
          <Stat v={money(b.cash_in_hand)} l="наличные на руках — сдать в кассу" />
          <Stat v={money(Math.abs(b.balance))} color={b.balance >= 0 ? th.ok : th.bad} l={b.balance >= 0 ? 'сервис должен вам' : 'вы должны сервису'} />
          <Stat v={money(b.earned_total)} l={`заработано всего · выплачено ${money(b.paid_out)}`} />
        </View>
        <T muted size={13}>За каждую доставку вы получаете {money(b.fee)}. Наличные от покупателей — деньги сервиса: они вычитаются из суммы к выплате, пока вы их не сдадите.</T>
        <Ledger rows={b.ledger} />
      </> : null}
    </Scroll>
  );
}

// Админ: расчёт с курьером
export function CourierMoney({ id, onDone }) {
  const th = useTheme();
  const { data: b, error, load } = useLoad(() => api('GET', `/admin/couriers/${id}/ledger`), [id]);
  const [type, setType] = React.useState('handover');
  const [amount, setAmount] = React.useState('');
  const [err, setErr] = React.useState('');
  const submit = async () => {
    setErr('');
    try { await api('POST', `/admin/couriers/${id}/settle`, { type, amount: Number(amount) }); setAmount(''); await load(); onDone?.(); }
    catch (e) { setErr(e.message); }
  };
  return (
    <Scroll error={error}>
      {b ? <>
        <T muted>{phone(b.courier.phone)}</T>
        <View style={s.row}>
          <Stat v={money(b.cash_in_hand)} l="наличные на руках" />
          <Stat v={(b.balance < 0 ? '−' : '') + money(Math.abs(b.balance))} color={b.balance >= 0 ? th.ok : th.bad} l={b.balance >= 0 ? 'сервис должен курьеру' : 'курьер должен сервису'} />
        </View>
        <Card style={{ gap: 10 }}>
          <H>Провести операцию</H>
          <Chips value={type} onChange={setType} options={[['handover', 'Сдал наличные'], ['payout', 'Выплата курьеру']]} />
          <Input placeholder="Сумма, ₸" keyboardType="number-pad" value={amount} onChangeText={setAmount} />
          <Err>{err}</Err>
          <Button title="Провести" onPress={submit} />
        </Card>
        <Ledger rows={b.ledger} />
      </> : null}
    </Scroll>
  );
}
