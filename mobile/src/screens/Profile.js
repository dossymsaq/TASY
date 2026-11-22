import React from 'react';
import { Linking } from 'react-native';
import { API_URL, DEMO, api, openSite, phone } from '../api';
import { Scroll, alertError, confirm } from '../common';
import { useNav } from '../nav';
import { Button, Card, Err, H, Input, T } from '../ui';

const ROLES = { seller: 'Продавец', client: 'Покупатель', courier: 'Курьер', admin: 'Администратор', support: 'Поддержка' };

export default function Profile() {
  const { user, setUser, logout } = useNav();
  const [f, setF] = React.useState({ name: user.name, shop_name: user.shop_name || '', pickup_address: user.pickup_address || '' });
  const [err, setErr] = React.useState('');
  const [ok, setOk] = React.useState(false);
  const [del, setDel] = React.useState('');
  const deleteAccount = async () => {
    if (del.trim().toUpperCase() !== 'УДАЛИТЬ') { alertError(new Error('Введите слово УДАЛИТЬ')); return; }
    if (!(await confirm('Удалить аккаунт навсегда?', 'Войти в него больше не получится.'))) return;
    try { await api('DELETE', '/me', { confirm: 'УДАЛИТЬ' }); await logout(); } catch (e) { alertError(e); }
  };
  const save = async () => {
    setErr(''); setOk(false);
    try { const r = await api('PATCH', '/me', f); setUser(r.user); setOk(true); } catch (e) { setErr(e.message); }
  };
  return (
    <Scroll>
      <Card style={{ gap: 12 }}>
        <H>{ROLES[user.role]}</H>
        <T muted>{phone(user.phone)}</T>
        <Input label="Имя" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
        {user.role === 'seller' ? <>
          <Input label="Магазин" value={f.shop_name} onChangeText={(v) => setF({ ...f, shop_name: v })} />
          <Input label="Адрес забора по умолчанию" value={f.pickup_address} onChangeText={(v) => setF({ ...f, pickup_address: v })} />
        </> : null}
        <Err>{err}</Err>
        {ok ? <T color="#1f9d55">Сохранено</T> : null}
        <Button title="Сохранить" onPress={save} />
        <Button kind="ghost" title="Выйти" onPress={logout} />
      </Card>
      {['seller', 'client'].includes(user.role) ? <Card style={{ gap: 10 }}>
        <T bold>Удалить аккаунт</T>
        <T muted size={13}>Имя, телефон и адрес будут стёрты. История доставок сохранится без ваших личных данных — её мы обязаны хранить по закону.{user.role === 'seller' ? ' Неоплаченные заказы будут отменены.' : ''}</T>
        <Input label="Чтобы подтвердить, введите УДАЛИТЬ" value={del} onChangeText={setDel} autoCapitalize="characters" />
        <Button kind="bad" title="Удалить аккаунт навсегда" onPress={deleteAccount} />
      </Card> : null}
      <Button kind="ghost" small title="Публичная оферта" onPress={() => openSite('/offer')} />
      <Button kind="ghost" small title="Политика конфиденциальности" onPress={() => openSite('/privacy')} />
      {DEMO ? <Card style={{ gap: 8 }}>
        <T bold>Демо-версия</T>
        <T muted size={13}>Сервер работает внутри приложения, данные хранятся только на этом телефоне. Оплата тестовая.</T>
        <Button kind="ghost" small title="Начать заново (стереть демо-данные)" onPress={async () => {
          if (!(await confirm('Стереть демо-данные?', 'После этого закройте и снова откройте приложение — появятся исходные демо-заказы.'))) return;
          require('../demo').resetDemo(); await logout();
        }} />
      </Card> : <T muted size={12} style={{ textAlign: 'center' }}>Сервер: {API_URL}</T>}
    </Scroll>
  );
}
