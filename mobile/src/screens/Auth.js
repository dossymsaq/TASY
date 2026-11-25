import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { api, phone as fmtPhone, saveToken } from '../api';
import { Button, Card, Chips, Err, H, Input, T, s } from '../ui';

const norm = (p) => { let d = String(p).replace(/\D/g, ''); if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1); if (d.length === 10) d = '7' + d; return d; };

// Вход: по SMS-коду (основной) или по паролю (сотрудники)
export default function Auth({ onLogin }) {
  const [mode, setMode] = React.useState('sms'); // sms | code | password
  const [f, setF] = React.useState({ phone: '', password: '', code: '', name: '', shop_name: '', pickup_address: '' });
  const [otp, setOtp] = React.useState({ is_new: false, dev_code: '', role: 'client' });
  const [err, setErr] = React.useState('');
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const done = async (r) => { await saveToken(r.token); onLogin(r.user); };
  const go = (m) => { setMode(m); setErr(''); };

  const request = async () => {
    setErr('');
    try {
      const r = await api('POST', '/auth/otp/request', { phone: f.phone });
      setOtp({ ...otp, is_new: r.is_new, dev_code: r.dev_code || '' });
      setF({ ...f, phone: norm(f.phone), code: '' }); setMode('code');
    } catch (e) { setErr(e.message); }
  };
  const verify = async () => {
    setErr('');
    try { await done(await api('POST', '/auth/otp/verify', { ...f, role: otp.role })); } catch (e) { setErr(e.message); }
  };
  const login = async () => {
    setErr('');
    try { await done(await api('POST', '/auth/login', { phone: f.phone, password: f.password })); } catch (e) { setErr(e.message); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.list, { paddingTop: 32 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <T bold size={30}>Жеткіз <T bold size={30} style={{ backgroundColor: '#fec50c', color: '#14212b' }}> 750 </T></T>
          <T muted style={{ textAlign: 'center', marginTop: 6 }}>Доставка по Астане до 2 кг.{'\n'}750 ₸ платит продавец + 750 ₸ покупатель</T>
        </View>
        <Chips value={mode === 'code' ? 'sms' : mode} onChange={go} options={[['sms', 'Вход по SMS'], ['password', 'По паролю']]} />
        <Card style={{ gap: 12 }}>
          {mode === 'sms' ? <>
            <H>Вход или регистрация</H>
            <T muted size={14}>Введите номер — пришлём код в SMS.</T>
            <Input label="Телефон" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+7 7XX XXX XX XX" autoComplete="tel" autoFocus />
            <Err>{err}</Err>
            <Button title="Получить код" onPress={request} />
          </> : null}

          {mode === 'code' ? <>
            <T>Код отправлен на <T bold>{fmtPhone(f.phone)}</T>  <T color="#00a3bf" onPress={() => go('sms')}>изменить</T></T>
            {otp.dev_code ? <View style={{ backgroundColor: '#fff1c7', borderRadius: 10, padding: 10 }}><T size={13} color="#7a5600">Тестовый режим, SMS не отправляются. Ваш код: <T bold color="#7a5600">{otp.dev_code}</T></T></View> : null}
            <Input label="Код из SMS" value={f.code} onChangeText={set('code')} keyboardType="number-pad" maxLength={4} textContentType="oneTimeCode" autoComplete="sms-otp" style={{ fontSize: 26, letterSpacing: 8, textAlign: 'center' }} />
            {otp.is_new ? <>
              <T muted size={14}>Вы у нас впервые — заполните профиль.</T>
              <Chips value={otp.role} onChange={(r) => setOtp({ ...otp, role: r })} options={[['client', 'Я покупатель'], ['seller', 'Я продавец']]} />
              <Input label="Ваше имя" value={f.name} onChangeText={set('name')} />
              {otp.role === 'seller' ? <>
                <Input label="Название магазина" value={f.shop_name} onChangeText={set('shop_name')} />
                <Input label="Адрес, откуда забирать товар" value={f.pickup_address} onChangeText={set('pickup_address')} />
              </> : null}
            </> : null}
            <Err>{err}</Err>
            <Button title={otp.is_new ? 'Зарегистрироваться' : 'Войти'} onPress={verify} />
            <Button kind="ghost" title="Отправить код ещё раз" onPress={request} />
          </> : null}

          {mode === 'password' ? <>
            <H>Вход по паролю</H>
            <Input label="Телефон" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+7 7XX XXX XX XX" />
            <Input label="Пароль" value={f.password} onChangeText={set('password')} secureTextEntry />
            <Err>{err}</Err>
            <Button title="Войти" onPress={login} />
            <T muted size={12}>Демо: продавец 77000000004/seller123 · покупатель 77000000005/client123 · курьер 77000000003/courier123 · админ 77000000001/admin123 · поддержка 77000000002/support123</T>
          </> : null}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
