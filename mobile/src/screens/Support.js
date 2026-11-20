import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { api, date, phone } from '../api';
import { Scroll, OrderCard, alertError, useLoad } from '../common';
import { useNav } from '../nav';
import { Badge, Button, Card, Empty, Err, H, Input, T, s, useTheme } from '../ui';

const TS = { open: 'Ожидает ответа', answered: 'Есть ответ', closed: 'Закрыто' };
const isStaff = (u) => ['support', 'admin'].includes(u?.role);

export function Tickets() {
  const { user, push } = useNav();
  const [filter, setFilter] = React.useState('');
  const { data, error, refreshing, load } = useLoad(() => api('GET', '/tickets' + (filter ? `?status=${filter}` : '')), [filter]);
  const [f, setF] = React.useState({ subject: '', order_code: '', message: '' });
  const [err, setErr] = React.useState('');
  const send = async () => {
    setErr('');
    try {
      await api('POST', '/tickets', { subject: f.subject, message: f.message, ...(f.order_code ? { order_code: f.order_code } : {}) });
      setF({ subject: '', order_code: '', message: '' }); load();
    } catch (e) { setErr(e.message); }
  };
  const staff = isStaff(user);
  return (
    <Scroll refreshing={refreshing} onRefresh={load} error={error}>
      {staff ? (
        <View style={s.row}>
          {[['', 'Все'], ['open', 'Ждут ответа'], ['answered', 'Отвечены'], ['closed', 'Закрыты']].map(([k, l]) =>
            <Button key={k} small kind={filter === k ? 'brand' : 'ghost'} title={l} onPress={() => setFilter(k)} />)}
        </View>
      ) : (
        <Card style={{ gap: 10 }}>
          <H>Написать в поддержку</H>
          <Input placeholder="Тема" value={f.subject} onChangeText={(v) => setF({ ...f, subject: v })} />
          <Input placeholder="Код заказа (необязательно)" autoCapitalize="characters" value={f.order_code} onChangeText={(v) => setF({ ...f, order_code: v })} />
          <Input placeholder="Сообщение" multiline value={f.message} onChangeText={(v) => setF({ ...f, message: v })} />
          <Err>{err}</Err>
          <Button title="Отправить" onPress={send} />
        </Card>
      )}
      {data && !data.tickets.length ? <Empty>Обращений нет</Empty> : null}
      {data?.tickets.map((t) => (
        <Pressable key={t.id} onPress={() => push('ticket', { id: t.id, title: `#${t.id} ${t.subject}`, onClose: load })}>
          <Card>
            <View style={s.between}><T bold style={{ flex: 1 }}>#{t.id} {t.subject}</T><Badge status={t.status} text={TS[t.status]} /></View>
            {staff ? <T muted size={13}>{t.contact_name} · {phone(t.contact_phone)}{t.order_code ? ' · заказ ' + t.order_code : ''}</T> : null}
            <T size={14} numberOfLines={2}>{t.last_message}</T>
            <T muted size={12}>{date(t.updated_at)}</T>
          </Card>
        </Pressable>
      ))}
    </Scroll>
  );
}

export function TicketChat({ id, onClose }) {
  const { user, pop } = useNav();
  const th = useTheme();
  const { data, error, load } = useLoad(() => api('GET', `/tickets/${id}`), [id]);
  const [msg, setMsg] = React.useState('');
  const scroll = React.useRef(null);
  const send = async () => {
    if (!msg.trim()) return;
    try { await api('POST', `/tickets/${id}/messages`, { message: msg }); setMsg(''); await load(); onClose?.(); }
    catch (e) { alertError(e); }
  };
  const close = async () => { try { await api('POST', `/tickets/${id}/close`); onClose?.(); pop(); } catch (e) { alertError(e); } };
  if (!data) return <Scroll error={error}><T muted>Загрузка…</T></Scroll>;
  const t = data.ticket;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scroll} contentContainerStyle={[s.list, { gap: 8 }]} onContentSizeChange={() => scroll.current?.scrollToEnd()}>
        {isStaff(user) ? <T muted size={13}>{t.contact_name} · {phone(t.contact_phone)}</T> : null}
        {data.order ? <OrderCard o={data.order} /> : null}
        {data.messages.map((m, i) => {
          const mine = isStaff({ role: m.author_role });
          return (
            <View key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: mine ? '#dff4f8' : th.card, borderColor: th.line, borderWidth: mine ? 0 : 1, borderRadius: 12, padding: 10 }}>
              <T size={12} color={mine ? '#31606b' : th.muted}>{m.author_name || 'Гость'} · {date(m.created_at)}</T>
              <T color={mine ? '#0f2f38' : th.text}>{m.body}</T>
            </View>
          );
        })}
      </ScrollView>
      {t.status !== 'closed' || isStaff(user) ? (
        <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderColor: th.line, backgroundColor: th.card }}>
          <Input placeholder="Сообщение" value={msg} onChangeText={setMsg} multiline style={{ minHeight: 46 }} />
          <View style={s.row}>
            <Button title="Отправить" onPress={send} style={{ flex: 1 }} />
            {t.status !== 'closed' ? <Button kind="ghost" title="Закрыть" onPress={close} /> : null}
          </View>
        </View>
      ) : <View style={{ padding: 16 }}><T muted>Обращение закрыто</T></View>}
    </KeyboardAvoidingView>
  );
}
