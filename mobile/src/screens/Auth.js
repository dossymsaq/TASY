import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { api, saveToken } from '../api';
import { Button, Card, Chips, Err, H, Input, T, s } from '../ui';

export default function Auth({ onLogin }) {
  const [mode, setMode] = React.useState('login');
  const [f, setF] = React.useState({ phone: '', password: '', name: '', shop_name: '', pickup_address: '' });
  const [err, setErr] = React.useState('');
  const set = (k) => (v) => setF({ ...f, [k]: v });

  const submit = async () => {
    setErr('');
    try {
      const r = mode === 'login'
        ? await api('POST', '/auth/login', { phone: f.phone, password: f.password })
        : await api('POST', '/auth/register', { ...f, role: mode });
      await saveToken(r.token);
      onLogin(r.user);
    } catch (e) { setErr(e.message); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.list, { paddingTop: 32 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <T bold size={30}>Жеткіз <T bold size={30} style={{ backgroundColor: '#fec50c', color: '#14212b' }}> 750 </T></T>
          <T muted style={{ textAlign: 'center', marginTop: 6 }}>Доставка по Астане до 2 кг.{'\n'}750 ₸ платит продавец + 750 ₸ покупатель</T>
        </View>
        <Chips value={mode} onChange={(m) => { setMode(m); setErr(''); }} options={[['login', 'Вход'], ['seller', 'Я продавец'], ['client', 'Я покупатель']]} />
        <Card style={{ gap: 12 }}>
          <H>{mode === 'login' ? 'Вход' : mode === 'seller' ? 'Регистрация продавца' : 'Регистрация покупателя'}</H>
          {mode !== 'login' ? <Input label="Ваше имя" value={f.name} onChangeText={set('name')} /> : null}
          <Input label="Телефон" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+7 7XX XXX XX XX" autoComplete="tel" />
          {mode === 'seller' ? <>
            <Input label="Название магазина" value={f.shop_name} onChangeText={set('shop_name')} />
            <Input label="Адрес, откуда забирать товар" value={f.pickup_address} onChangeText={set('pickup_address')} />
          </> : null}
          <Input label="Пароль" value={f.password} onChangeText={set('password')} secureTextEntry />
          <Err>{err}</Err>
          <Button title={mode === 'login' ? 'Войти' : 'Зарегистрироваться'} onPress={submit} />
          {mode === 'login' ? <T muted size={12}>Демо: продавец 77000000004/seller123 · покупатель 77000000005/client123 · курьер 77000000003/courier123 · админ 77000000001/admin123 · поддержка 77000000002/support123</T> : null}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
