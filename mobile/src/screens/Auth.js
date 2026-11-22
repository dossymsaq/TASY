import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { DEMO, api, money, openSite, saveToken } from '../api';
import { useNav } from '../nav';
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
  const { cfg } = useNav();
  const sms = cfg?.sms_login !== false; // мягкий старт: без SMS — вход по паролю, клиенты без входа
  const [track, setTrack] = React.useState(null);
  const [leadSent, setLeadSent] = React.useState(false);
  const signup = !!cfg?.seller_signup; // false — аккаунты продавцов выдаёт владелец, вместо регистрации заявка
  const [mode, setMode] = React.useState('choose'); // choose | owner | courier | seller | seller-apply | client
  const empty = { phone: '', password: '', name: '', shop_name: '', pickup_address: '', code: '' };
  const [f, setF] = React.useState(empty);
  const [sent, setSent] = React.useState(false);
  const [needName, setNeedName] = React.useState(false);
  const [err, setErr] = React.useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const go = (m, keep = false) => { setMode(m); setErr(''); setNeedName(false); setTrack(null); setLeadSent(false); if (!keep) { setSent(false); setF(empty); } };

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
      if (mode === 'seller-apply' && !signup) {
        await api('POST', '/tickets', { subject: `Подключение магазина: ${f.shop_name}`, message: `Магазин: ${f.shop_name}\nАдрес: ${f.pickup_address || 'не указан'}`, contact_name: f.name, contact_phone: f.phone });
        setLeadSent(true); return;
      }
      if (isPassword) return await done(await api('POST', '/auth/login', { phone: f.phone, password: f.password }));
      if (!sms && mode === 'seller-apply') return await done(await api('POST', '/auth/register', { role: 'seller', name: f.name, phone: f.phone, shop_name: f.shop_name, pickup_address: f.pickup_address, password: f.password }));
      if (mode === 'seller-apply' && !signup) {
    return (
      <ScrollView contentContainerStyle={[s.list, { paddingTop: 32 }]} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 12 }}>
          <H>{leadSent ? 'Заявка отправлена' : 'Подключить магазин'}</H>
          {leadSent ? <T>Спасибо! Мы позвоним вам, заключим договор и выдадим логин и пароль для входа.</T> : <>
            <T muted size={14}>Доставка по Астане — 750 ₸, посылки до 2 кг. Оставьте контакты — мы позвоним и выдадим логин и пароль.</T>
            <Input label="Ваше имя" value={f.name} onChangeText={set('name')} />
            <Input label="Телефон" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+7 7XX XXX XX XX" />
            <Input label="Название магазина" value={f.shop_name} onChangeText={set('shop_name')} />
            <Input label="Адрес, откуда забирать (необязательно)" value={f.pickup_address} onChangeText={set('pickup_address')} />
            <Err>{err}</Err>
            <Button kind="sun" title="Отправить заявку" onPress={submit} />
          </>}
          {link('← Выбрать другой вход', () => go('choose'))}
        </Card>
      </ScrollView>
    );
  }
  if (!sms && mode === 'client') { setTrack((await api('GET', `/track/${encodeURIComponent(f.code.trim().toUpperCase())}`)).order); return; }
      if (!sent) return await requestCode();
      const body = { phone: f.phone, code: f.code, role: mode === 'client' ? 'client' : 'seller' };
      if (mode === 'seller-apply' || needName) Object.assign(body, { name: f.name, shop_name: f.shop_name, pickup_address: f.pickup_address });
      const r = await api('POST', '/auth/otp/verify', body);
      if (r.need_profile) {
        if (mode === 'seller' && !signup) { setErr('Этот номер не подключён. Логин выдаёт владелец сервиса — оставьте заявку «Подключить магазин».'); return; }
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
    seller: 'Для магазинов, работающих с нами по договору. Логин и пароль выдаёт владелец сервиса.',
    'seller-apply': 'Доставка по Астане — 750 ₸, посылки до 2 кг. После заявки мы свяжемся с вами и заключим договор.',
    client: 'Посылки, отправленные на ваш номер, появятся автоматически.',
  }[mode];
  const isPassword = mode === 'owner' || mode === 'courier' || (!sms && mode === 'seller');
  const hint = DEMO ? (!sms && mode === 'seller' ? 'продавец 77000000004 / seller123' : !sms && mode === 'client' ? null : DEMO_HINT[mode === 'seller-apply' ? 'seller' : mode]) : null;
  const roles = sms ? ROLES : ROLES.map((r) => (r[0] === 'client' ? ['client', '📦', 'Где моя посылка?', 'Отслеживание по коду заказа — вход не нужен'] : r));
  if (!sms && mode === 'client') {
    return (
      <ScrollView contentContainerStyle={[s.list, { paddingTop: 32 }]} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 12 }}>
          <H>Где моя посылка?</H>
          <T muted size={14}>Вход не нужен. Введите код заказа из сообщения продавца.</T>
          <Input label="Код заказа" value={f.code} onChangeText={set('code')} autoCapitalize="characters" placeholder="Например, K7QX2M9A" />
          <Err>{err}</Err>
          <Button title="Найти" onPress={submit} />
          {track ? <View style={{ gap: 6 }}>
            <T bold size={18}>{track.status_text}</T>
            <T>{track.item_desc} · от «{track.seller?.shop_name || track.seller?.name}»</T>
            <T muted size={14}>{track.address}, р-н {track.district}</T>
            {track.courier ? <T size={14}>Курьер: {track.courier.name}</T> : null}
            {!track.buyer_paid && track.status !== 'cancelled' ? <T size={14}>Доставка {money(cfg.price_buyer)} — наличными курьеру при получении.</T> : null}
          </View> : null}
          {link('← Выбрать другой вход', () => go('choose'))}
        </Card>
      </ScrollView>
    );
  }

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
            {roles.map(([m, icon, t, d]) => (
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
            {isPassword || (!sms && mode === 'seller-apply') ? <Input label={mode === 'seller-apply' ? 'Придумайте пароль (мин. 6)' : 'Пароль'} value={f.password} onChangeText={set('password')} secureTextEntry /> : null}
            {sent && !isPassword ? <Input label="Код из SMS" value={f.code} onChangeText={set('code')} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" textContentType="oneTimeCode" /> : null}
            <Err>{err}</Err>
            <Button title={isPassword ? 'Войти' : !sms ? 'Отправить заявку' : !sent ? 'Получить код по SMS' : mode === 'seller-apply' ? 'Отправить заявку' : 'Войти'} onPress={submit} />
            {!isPassword ? <T muted size={12}>Продолжая, вы принимаете условия{' '}
              <T size={12} color={th.brand} onPress={() => openSite('/offer')}>публичной оферты</T> и{' '}
              <T size={12} color={th.brand} onPress={() => openSite('/privacy')}>политики конфиденциальности</T>.</T> : null}
            {sent && !isPassword ? link('Отправить код ещё раз', requestCode) : null}
            {mode === 'seller' ? link(signup ? 'Ещё не работаете с нами? Подать заявку' : 'Ещё не работаете с нами? Подключить магазин', () => go('seller-apply')) : null}
            {mode === 'seller-apply' ? link('Уже подключены? Войти', () => go('seller')) : null}
            {hint ? <T muted size={12}>Демо: {hint}</T> : null}
            {link('← Выбрать другой вход', () => go('choose'))}
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
