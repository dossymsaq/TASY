import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { DEMO, api, openSite, saveToken } from '../api';
import { Button, Card, Err, H, Input, T, s, useTheme } from '../ui';

// Четыре входа: владелец и курьер — по паролю; продавец и клиент — по SMS-коду.
// Продавец работает по договору: новый продавец подаёт заявку, владелец её одобряет.
const ROLES = [
  ['owner', '🛡', 'Владелец', 'Выручка, заказы, курьеры, заявки продавцов'],
  ['seller', '🛍', 'Продавец', 'Для магазинов, работающих с нами по договору'],
  ['client', '👤', 'Клиент', 'Посылки на ваш номер и их статус'],
  ['courier', '🛵', 'Курьер', 'Заказы, маршрут, вручение'],
];
const DEMO_HINT = {
  owner: 'владелец 77000000001 / admin123, поддержка 77000000002 / support123',
  courier: 'курьер 77000000003 / courier123',
  seller: 'продавец 77000000004 — код подставится сам',
  client: 'клиент 77000000005 — код подставится сам',
};

export default function Auth({ onLogin }) {
  const th = useTheme();
  const [mode, setMode] = React.useState('choose'); // choose | owner | courier | seller | seller-apply | client
  const empty = { phone: '', password: '', name: '', shop_name: '', pickup_address: '', code: '' };
  const [f, setF] = React.useState(empty);
  const [sent, setSent] = React.useState(false);
  const [needName, setNeedName] = React.useState(false);
  const [err, setErr] = React.useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const go = (m, keep = false) => { setMode(m); setErr(''); setNeedName(false); if (!keep) { setSent(false); setF(empty); } };

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
      if (mode === 'owner' || mode === 'courier') return await done(await api('POST', '/auth/login', { phone: f.phone, password: f.password }));
      if (!sent) return await requestCode();
      const body = { phone: f.phone, code: f.code, role: mode === 'client' ? 'client' : 'seller' };
      if (mode === 'seller-apply' || needName) Object.assign(body, { name: f.name, shop_name: f.shop_name, pickup_address: f.pickup_address });
      const r = await api('POST', '/auth/otp/verify', body);
      if (r.need_profile) {
        if (mode === 'seller') { go('seller-apply', true); setErr('Этот номер ещё не подключён. Заполните заявку — код уже подтверждён.'); return; }
        setNeedName(true); setErr('Номер новый — укажите имя, чтобы создать кабинет.'); return;
      }
      await done(r);
    } catch (e) { setErr(e.message); }
  };

  const link = (text, onPress) => <Pressable onPress={onPress} hitSlop={8}><T color={th.brand} size={14}>{text}</T></Pressable>;
  const title = { owner: 'Вход для владельца', courier: 'Вход для курьера', seller: 'Вход для продавца', 'seller-apply': 'Заявка на подключение', client: 'Вход для клиента' }[mode];
  const note = {
    owner: 'Сотрудники поддержки входят здесь же.',
    courier: 'Логин и пароль выдаёт владелец сервиса.',
    seller: 'Для магазинов, работающих с нами по договору.',
    'seller-apply': 'Доставка по Астане — 750 ₸, посылки до 2 кг. После заявки мы свяжемся с вами и заключим договор.',
    client: 'Посылки, отправленные на ваш номер, появятся автоматически.',
  }[mode];
  const isPassword = mode === 'owner' || mode === 'courier';
  const hint = DEMO ? DEMO_HINT[mode === 'seller-apply' ? 'seller' : mode] : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.list, { paddingTop: 32 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <T bold size={30}>Жеткіз <T bold size={30} style={{ backgroundColor: '#fec50c', color: '#14212b' }}> 750 </T></T>
          <T muted style={{ textAlign: 'center', marginTop: 6 }}>Доставка по Астане — 750 ₸{'\n'}Посылки до 2 кг в любой район города</T>
        </View>
        {DEMO && mode === 'choose' ? <Card style={{ backgroundColor: '#fec50c', borderColor: '#fec50c' }}>
          <T bold color="#14212b">Демо-версия</T>
          <T size={13} color="#14212b">Интернет не нужен, данные хранятся на телефоне. В каждом входе есть подсказка с тестовым аккаунтом.</T>
        </Card> : null}

        {mode === 'choose' ? (
          <Card style={{ gap: 12 }}>
            <H>Кто вы?</H>
            {ROLES.map(([m, icon, t, d]) => (
              <Pressable key={m} onPress={() => go(m)} accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', gap: 14, alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: th.line, backgroundColor: th.bg, opacity: pressed ? 0.8 : 1 })}>
                <T size={26}>{icon}</T>
                <View style={{ flex: 1 }}><T bold size={17}>{t}</T><T muted size={13}>{d}</T></View>
                <T muted size={20}>›</T>
              </Pressable>
            ))}
          </Card>
        ) : (
          <Card style={{ gap: 12 }}>
            <H>{title}</H>
            <T muted size={14}>{note}</T>
            {mode === 'seller-apply' || needName ? <Input label="Ваше имя" value={f.name} onChangeText={set('name')} /> : null}
            <Input label="Телефон" value={f.phone} onChangeText={set('phone')} editable={!sent} keyboardType="phone-pad" placeholder="+7 7XX XXX XX XX" autoComplete="tel" />
            {mode === 'seller-apply' ? <>
              <Input label="Название магазина" value={f.shop_name} onChangeText={set('shop_name')} />
              <Input label="Адрес, откуда забирать товар" value={f.pickup_address} onChangeText={set('pickup_address')} />
            </> : null}
            {isPassword ? <Input label="Пароль" value={f.password} onChangeText={set('password')} secureTextEntry /> : null}
            {sent && !isPassword ? <Input label="Код из SMS" value={f.code} onChangeText={set('code')} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" /> : null}
            <Err>{err}</Err>
            <Button title={isPassword ? 'Войти' : !sent ? 'Получить код по SMS' : mode === 'seller-apply' ? 'Отправить заявку' : 'Войти'} onPress={submit} />
            {!isPassword ? <T muted size={12}>Продолжая, вы принимаете условия{' '}
              <T size={12} color={th.brand} onPress={() => openSite('/offer')}>публичной оферты</T> и{' '}
              <T size={12} color={th.brand} onPress={() => openSite('/privacy')}>политики конфиденциальности</T>.</T> : null}
            {sent && !isPassword ? link('Отправить код ещё раз', requestCode) : null}
            {mode === 'seller' ? link('Ещё не работаете с нами? Подать заявку', () => go('seller-apply')) : null}
            {mode === 'seller-apply' ? link('Уже подключены? Войти', () => go('seller')) : null}
            {hint ? <T muted size={12}>Демо: {hint}</T> : null}
            {link('← Выбрать другой вход', () => go('choose'))}
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
