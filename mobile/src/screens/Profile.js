import React from 'react';
import { Linking } from 'react-native';
import { API_URL, api, phone } from '../api';
import { Scroll } from '../common';
import { useNav } from '../nav';
import { Button, Card, Err, H, Input, T } from '../ui';

const ROLES = { seller: 'Продавец', client: 'Покупатель', courier: 'Курьер', admin: 'Администратор', support: 'Поддержка' };

export default function Profile() {
  const { user, setUser, logout } = useNav();
  const [f, setF] = React.useState({ name: user.name, shop_name: user.shop_name || '', pickup_address: user.pickup_address || '' });
  const [err, setErr] = React.useState('');
  const [ok, setOk] = React.useState(false);
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
      <Button kind="ghost" small title="Публичная оферта" onPress={() => Linking.openURL(`${API_URL}/offer`)} />
      <Button kind="ghost" small title="Политика конфиденциальности" onPress={() => Linking.openURL(`${API_URL}/privacy`)} />
      <T muted size={12} style={{ textAlign: 'center' }}>Сервер: {API_URL}</T>
    </Scroll>
  );
}
