import React from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { DEMO, api, openSite, saveToken } from '../api';
import { Button, Card, Chips, Err, H, Input, T, s } from '../ui';

// Вход и регистрация по SMS-коду. Сотрудники могут войти по паролю.
export default function Auth({ onLogin }) {
  const [mode, setMode] = React.useState('login'); // login | seller | client | password
  const [f, setF] = React.useState({ phone: '', password: '', name: '', shop_name: '', pickup_address: '', code: '' });
  const [sent, setSent] = React.useState(false);
  const [needName, setNeedName] = React.useState(false);
  const [err, setErr] = React.useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const switchMode = (m) => { setMode(m); setErr(''); setSent(false); setNeedName(false); setF((x) => ({ ...x, code: '' })); };

  const done = async (r) => { await saveToken(r.token); onLogin(r.user); };
  const requestCode = async () => {
    setErr('');
    try {
      const r = await api('POST', '/auth/otp/request', { phone: f.phone });
      setSent(true);
      if (r.dev_code) { set('code')(r.dev_code); setErr(`Тестовый режим: код ${r.dev_code}`); }
    } catch (e) { setErr(e.message); }
  };
  const submit = async () => {
    setErr('');
    try {
      if (mode === 'password') return await done(await api('POST', '/auth/login', { phone: f.phone, password: f.password }));
      if (!sent) return await requestCode();
      const body = { phone: f.phone, code: f.code, role: mode === 'seller' ? 'seller' : 'client' };
      if (mode !== 'login' || needName) Object.assign(body, { name: f.name, shop_name: f.shop_name, pickup_address: f.pickup_address });
      const r = await api('POST', '/auth/otp/verify', body);
      if (r.need_profile) { setNeedName(true); setErr('Номер новый — укажите имя, чтобы создать кабинет покупателя.'); return; }
      await done(r);
    } catch (e) { setErr(e.message); }
  };

  const title = { login: 'Вход', password: 'Вход по паролю', seller: 'Регистрация продавца', client: 'Регистрация покупателя' }[mode];
  const showName = mode === 'seller' || mode === 'client' || needName;
  const link = (text, onPress) => <Pressable onPress={onPress}><T color="#00a3bf" size={14}>{text}</T></Pressable>;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.list, { paddingTop: 32 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <T bold size={30}>Жеткіз <T bold size={30} style={{ backgroundColor: '#fec50c', color: '#14212b' }}> 750 </T></T>
          <T muted style={{ textAlign: 'center', marginTop: 6 }}>Доставка по Астане до 2 кг.{'\n'}750 ₸ платит продавец + 750 ₸ покупатель</T>
        </View>
        {DEMO ? <Card style={{ backgroundColor: '#fec50c', borderColor: '#fec50c' }}>
          <T bold color="#14212b">Демо-версия</T>
          <T size={13} color="#14212b">Интернет не нужен, данные хранятся на телефоне. Нажмите «Войти по паролю (для сотрудников)» — там готовые аккаунты продавца, покупателя, курьера и админа. Код из SMS в демо подставляется сам.</T>
        </Card> : null}
        <Chips value={mode === 'password' ? 'login' : mode} onChange={switchMode} options={[['login', 'Вход'], ['seller', 'Я продавец'], ['client', 'Я покупатель']]} />
        <Card style={{ gap: 12 }}>
          <H>{title}</H>
          {showName ? <Input label="Ваше имя" value={f.name} onChangeText={set('name')} /> : null}
          <Input label="Телефон" value={f.phone} onChangeText={set('phone')} editable={!sent} keyboardType="phone-pad" placeholder="+7 7XX XXX XX XX" autoComplete="tel" />
          {mode === 'seller' ? <>
            <Input label="Название магазина" value={f.shop_name} onChangeText={set('shop_name')} />
            <Input label="Адрес, откуда забирать товар" value={f.pickup_address} onChangeText={set('pickup_address')} />
          </> : null}
          {mode === 'password' ? <Input label="Пароль" value={f.password} onChangeText={set('password')} secureTextEntry /> : null}
          {sent ? <Input label="Код из SMS" value={f.code} onChangeText={set('code')} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" /> : null}
          <Err>{err}</Err>
          <Button title={mode === 'password' || sent ? 'Войти' : 'Получить код по SMS'} onPress={submit} />
          <T muted size={12}>Продолжая, вы принимаете условия{' '}
            <T size={12} color="#00a3bf" onPress={() => openSite('/offer')}>публичной оферты</T> и{' '}
            <T size={12} color="#00a3bf" onPress={() => openSite('/privacy')}>политики конфиденциальности</T>.</T>
          {sent ? link('Отправить код ещё раз', requestCode) : null}
          {mode === 'login' ? link('Войти по паролю (для сотрудников)', () => switchMode('password')) : null}
          {mode === 'password' ? <>
            {link('← Войти по SMS-коду', () => switchMode('login'))}
            <T muted size={12}>Демо: продавец 77000000004/seller123 · покупатель 77000000005/client123 · курьер 77000000003/courier123 · админ 77000000001/admin123 · поддержка 77000000002/support123</T>
          </> : null}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
