import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const API = 'https://mindcrafti-school-production.up.railway.app/api/v1';
const SESSION_KEY = 'mindcrafti.mobile.accessToken';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type User = { fullName?: string; role?: string };
type LoginResult = { accessToken: string; user: User };

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [working, setWorking] = useState(false);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [pushState, setPushState] = useState('Не подключены');

  useEffect(() => {
    let active = true;
    void (async () => {
      const existing = await SecureStore.getItemAsync(SESSION_KEY);
      if (!existing) return;
      try {
        const response = await fetch(API + '/auth/me', { headers: { Authorization: 'Bearer ' + existing } });
        if (!response.ok) throw new Error('Session expired');
        const person = await response.json() as User;
        if (active) { setAccessToken(existing); setUser(person); }
      } catch {
        await SecureStore.deleteItemAsync(SESSION_KEY);
      }
    })();
    void Notifications.getPermissionsAsync().then(result => {
      if (active) setPermission(result.granted ? 'granted' : 'denied');
    });
    return () => { active = false; };
  }, []);

  async function login() {
    if (!email.trim() || !password) { Alert.alert('Mindcrafti', 'Введите логин и пароль.'); return; }
    setWorking(true);
    try {
      const response = await fetch(API + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!response.ok) throw new Error('Проверьте логин и пароль.');
      const session = await response.json() as LoginResult;
      if (!session.accessToken) throw new Error('Сервер не вернул токен.');
      await SecureStore.setItemAsync(SESSION_KEY, session.accessToken);
      setAccessToken(session.accessToken);
      setUser(session.user);
      setPassword('');
    } catch (err) { Alert.alert('Не удалось войти', String((err as Error).message)); }
    finally { setWorking(false); }
  }

  async function enableNotifications() {
    setWorking(true);
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('mindcrafti', {
          name: 'Mindcrafti', importance: Notifications.AndroidImportance.HIGH,
        });
      }
      const existing = await Notifications.getPermissionsAsync();
      const result = existing.granted ? existing : await Notifications.requestPermissionsAsync();
      setPermission(result.granted ? 'granted' : 'denied');
      if (!result.granted) {
        setPushState('Разрешение не выдано');
        Alert.alert('Уведомления выключены', 'Разрешите их в настройках телефона.');
        return;
      }
      // A remote token is obtained only in a signed native build with a linked Expo EAS project.
      const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) {
        setPushState('Разрешены. Требуется привязка Expo');
        return;
      }
      const resultToken = await Notifications.getExpoPushTokenAsync({ projectId });
      if (!resultToken.data) throw new Error('Не удалось получить push-токен.');
      // Registration with the school API will be added as a separate authenticated endpoint.
      // Never report "connected" until the backend has confirmed registration.
      setPushState('Токен телефона получен. Сервер ещё не подключён');
    } catch (err) {
      setPushState('Ошибка подключения');
      Alert.alert('Не удалось подключить push', String((err as Error).message));
    } finally { setWorking(false); }
  }

  async function testLocalNotification() {
    const status = await Notifications.getPermissionsAsync();
    if (!status.granted) {
      Alert.alert('Сначала включите уведомления', 'Нажмите «Включить уведомления».');
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Mindcrafti', body: 'Тестовое уведомление работает!' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
    });
    Alert.alert('Готово', 'Локальное тестовое уведомление запланировано через 3 секунды.');
  }

  async function logout() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setAccessToken(null);
    setUser(null);
    setPushState('Не подключены');
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}><Text style={styles.logoText}>M</Text></View>
        <Text style={styles.title}>Mindcrafti</Text>
        <Text style={styles.subtitle}>Школа всегда на связи</Text>
        {!accessToken ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Вход в аккаунт</Text>
            <Text style={styles.caption}>Используйте логин от платформы Mindcrafti.</Text>
            <TextInput style={styles.input} placeholder="Электронная почта" placeholderTextColor="#8090a7" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
            <TextInput style={styles.input} placeholder="Пароль" placeholderTextColor="#8090a7" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} />
            <Pressable disabled={working} style={styles.button} onPress={login}>{working ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Войти</Text>}</Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Уведомления</Text>
            <Text style={styles.caption}>Аккаунт: {user?.fullName || email || 'Mindcrafti'}</Text>
            <Text style={styles.status}>Система: {permission === 'granted' ? 'разрешены' : 'выключены'}</Text>
            <Text style={styles.status}>Подписка: {pushState}</Text>
            <Pressable disabled={working} style={styles.button} onPress={enableNotifications}>{working ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Включить уведомления</Text>}</Pressable>
            <Pressable style={styles.secondaryButton} onPress={testLocalNotification}><Text style={styles.secondaryText}>Проверить на телефоне</Text></Pressable>
            <Pressable style={styles.exit} onPress={logout}><Text style={styles.exitText}>Выйти</Text></Pressable>
          </View>
        )}
        <Text style={styles.footer}>Первая тестовая версия · iOS и Android</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220' },
  screen: { flexGrow: 1, padding: 24, paddingTop: 65, alignItems: 'center', justifyContent: 'center' },
  logo: { height: 76, width: 76, borderRadius: 22, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  logoText: { color: '#fff', fontSize: 44, fontWeight: '800' },
  title: { color: '#fff', fontSize: 34, fontWeight: '800' },
  subtitle: { color: '#a9bad3', fontSize: 16, marginTop: 6, marginBottom: 36 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#162236', borderRadius: 20, padding: 22, gap: 14 },
  cardTitle: { color: '#fff', fontSize: 21, fontWeight: '700' },
  caption: { color: '#bac9de', fontSize: 14, lineHeight: 20 },
  input: { backgroundColor: '#0b1220', borderWidth: 1, borderColor: '#3b4a63', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, color: '#fff', fontSize: 16 },
  button: { backgroundColor: '#2563eb', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  status: { color: '#dce8fa', fontSize: 14, lineHeight: 20 },
  secondaryButton: { borderWidth: 1, borderColor: '#4b6585', paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  secondaryText: { color: '#e3edff', fontWeight: '600' },
  exit: { marginTop: 6, alignItems: 'center', padding: 10 },
  exitText: { color: '#a9bad3' },
  footer: { color: '#8090a7', marginTop: 32, fontSize: 12 },
});
