import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';

const light = { bg: '#f4f7f9', card: '#ffffff', text: '#14212b', muted: '#5d6d7a', line: '#e2e8ee', brand: '#00a3bf', sun: '#fec50c', ok: '#1f9d55', warn: '#c27c00', bad: '#d63c3c', input: '#f4f7f9' };
const dark = { ...light, bg: '#0f1820', card: '#17232d', text: '#e8eef2', muted: '#9aabb8', line: '#263541', brand: '#19b8d4', input: '#0f1820' };
export const useTheme = () => (useColorScheme() === 'dark' ? dark : light);

export function Card({ children, style }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 }, style]}>{children}</View>;
}
export function T({ children, muted, bold, size, color, style, ...p }) {
  const t = useTheme();
  return <Text {...p} style={[{ color: color || (muted ? t.muted : t.text), fontSize: size || 15, fontWeight: bold ? '700' : '400' }, style]}>{children}</Text>;
}
export function H({ children, style }) {
  return <T bold size={20} style={[{ marginBottom: 4 }, style]}>{children}</T>;
}
export function Button({ title, onPress, kind = 'brand', small, disabled, style }) {
  const t = useTheme();
  const [busy, setBusy] = React.useState(false);
  const bg = { brand: t.brand, sun: t.sun, ghost: 'transparent', bad: t.bad }[kind];
  const fg = kind === 'sun' ? '#14212b' : kind === 'ghost' ? t.text : '#fff';
  const press = async () => {
    if (busy) return;
    setBusy(true);
    try { await onPress?.(); } finally { setBusy(false); }
  };
  return (
    <Pressable onPress={press} disabled={disabled || busy} accessibilityRole="button"
      style={({ pressed }) => [{ backgroundColor: bg, borderRadius: 10, paddingVertical: small ? 8 : 13, paddingHorizontal: small ? 12 : 18, alignItems: 'center', justifyContent: 'center', minHeight: small ? 36 : 46, opacity: disabled ? 0.5 : pressed ? 0.8 : 1, borderWidth: kind === 'ghost' ? 1 : 0, borderColor: t.line }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 14 : 16 }}>{title}</Text>}
    </Pressable>
  );
}
export function Input({ label, style, ...p }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {label ? <T bold size={14}>{label}</T> : null}
      <TextInput placeholderTextColor={t.muted} {...p}
        style={[{ borderWidth: 1, borderColor: t.line, backgroundColor: t.input, color: t.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, minHeight: 46 }, p.multiline && { minHeight: 80, textAlignVertical: 'top' }, style]} />
    </View>
  );
}
export function Chips({ options, value, onChange }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)}
          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: value === k ? t.brand : t.card, borderWidth: 1, borderColor: value === k ? t.brand : t.line }}>
          <Text style={{ color: value === k ? '#fff' : t.text, fontWeight: '600' }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const BADGE = { new: ['#fff1c7', '#7a5600'], ready: ['#dff4f8', '#00627a'], assigned: ['#e3ecff', '#234aa8'], picked_up: ['#e3ecff', '#234aa8'], delivered: ['#dcf3e5', '#17663a'], cancelled: ['#fbe2e2', '#9b2626'], open: ['#fff1c7', '#7a5600'], answered: ['#dff4f8', '#00627a'], closed: ['#dcf3e5', '#17663a'] };
export function Badge({ status, text }) {
  const [bg, fg] = BADGE[status] || ['#e2e8ee', '#14212b'];
  return <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}><Text style={{ color: fg, fontWeight: '600', fontSize: 13 }}>{text}</Text></View>;
}
export function Err({ children }) {
  const t = useTheme();
  return children ? <T color={t.bad} size={14}>{children}</T> : null;
}
export function Empty({ children }) {
  return <Card><T muted>{children}</T></Card>;
}
export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  list: { padding: 16, gap: 12, paddingBottom: 32 },
});
