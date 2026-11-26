import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Platform, Pressable, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const API = 'https://mindcrafti-school-production.up.railway.app/api/v1';
const SCHOOL_ORIGIN = 'https://mc-school-production.up.railway.app';
const SESSION_KEY = 'mindcrafti.mobile.accessToken';
const PUSH_TOKEN_KEY = 'mindcrafti.mobile.pushToken';

type User = { id?: string; fullName?: string; role?: string; preferredLanguage?: string };
type LoginResult = { accessToken: string; user: User };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [working, setWorking] = useState(false);
  const [webError, setWebError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await SecureStore.getItemAsync(SESSION_KEY);
        if (!token) return;
        const res = await fetch(API + '/auth/me', {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            await SecureStore.deleteItemAsync(SESSION_KEY);
          }
          return;
        }
        const person = await res.json() as User;
        if (active) {
          setUser(person);
          setAccessToken(token);
        }
      } catch {
        // Leave the stored token in place on temporary network failures.
      } finally {
        if (active) setLoadingSession(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function login() {
    if (!loginId.trim() || !password) {
      Alert.alert('Mindcrafti', 'Введите логин и пароль от школы.');
      return;
    }
    setWorking(true);
    try {
      const response = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginId.trim(), password }),
      });
      if (!response.ok) throw new Error('Неверный логин или пароль.');
      const data = await response.json() as LoginResult;
      if (!data.accessToken || !data.user) throw new Error('Неполный ответ сервера.');
      await SecureStore.setItemAsync(SESSION_KEY, data.accessToken);
      setAccessToken(data.accessToken);
      setUser(data.user);
      setPassword('');
      setWebError(false);
    } catch (error) {
      Alert.alert('Не удалось войти', (error as Error).message);
    } finally {
      setWorking(false);
    }
  }

  // Ask iOS for permission after login, not via a permanent native toolbar.
  // iOS displays the system dialog only when permission is undetermined.
  // When the backend endpoint is deployed, register the Expo token silently.
  useEffect(() => {
    if (!accessToken || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('mindcrafti', {
            name: 'Mindcrafti',
            importance: Notifications.AndroidImportance.HIGH,
          });
        }
        const previous = await Notifications.getPermissionsAsync();
        const permission = previous.status === 'undetermined'
          ? await Notifications.requestPermissionsAsync()
          : previous;
        if (!permission.granted || cancelled) return;

        const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) return;
        const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (!expoToken || cancelled) return;
        const response = await fetch(API + '/mobile-push/devices', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: expoToken, platform: Platform.OS }),
        });
        if (response.ok && !cancelled) {
          await SecureStore.setItemAsync(PUSH_TOKEN_KEY, expoToken);
        }
        // The production API does not yet expose the mobile push endpoint.
        // Do not interrupt the parent dashboard with a technical error.
      } catch {
        // Offline users should still be able to use the school dashboard.
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken, user?.id]);

  async function handleWebLogout() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setAccessToken(null);
    setUser(null);
    setLoginId('');
    setPassword('');
  }

  // The existing web app reads accessToken and authUser from origin-scoped localStorage.
  // Run only for the trusted school origin. Never inject credentials into external URLs.
  const bootstrap = useMemo(() => {
    if (!accessToken || !user) return '';
    const tokenJson = JSON.stringify(accessToken);
    const userJson = JSON.stringify(JSON.stringify(user));
    const originJson = JSON.stringify(SCHOOL_ORIGIN);
    return `(function(){
      if (window.location.origin === ${originJson}) {
        try {
          window.localStorage.setItem('accessToken', ${tokenJson});
          window.localStorage.setItem('authUser', ${userJson});
        } catch (e) {}
      }
    })(); true;`;
  }, [accessToken, user]);

  if (loadingSession) {
    return <SafeAreaView style={styles.center}><ActivityIndicator color="#5b91ff" /></SafeAreaView>;
  }

  if (!accessToken || !user) {
    return <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.loginScreen} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}><Text style={styles.logoText}>M</Text></View>
        <Text style={styles.title}>Mindcrafti</Text>
        <Text style={styles.subtitle}>Вход в школьный кабинет</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ваш аккаунт</Text>
          <TextInput style={styles.input} placeholder="Электронная почта или логин"
            placeholderTextColor="#879bb6" autoCapitalize="none" autoCorrect={false}
            value={loginId} onChangeText={setLoginId} />
          <TextInput style={styles.input} placeholder="Пароль" placeholderTextColor="#879bb6"
            secureTextEntry value={password} onChangeText={setPassword} />
          <Pressable style={styles.button} disabled={working} onPress={login}>
            {working ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Войти</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>;
  }

  return <SafeAreaView style={styles.root}>
    <StatusBar barStyle="light-content" />
    <View style={styles.webContainer}>
      {webError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Не удалось открыть кабинет Mindcrafti.</Text>
          <Pressable style={styles.button} onPress={() => setWebError(false)}>
            <Text style={styles.buttonText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          key={user.id ?? user.role ?? 'school'}
          source={{ uri: SCHOOL_ORIGIN + (user.role === 'PARENT' ? '/parent' : '/') + '?mobileRefresh=20261126-2' }}
          cacheEnabled={false}
          originWhitelist={[SCHOOL_ORIGIN]}
          injectedJavaScriptBeforeContentLoaded={bootstrap}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          onShouldStartLoadWithRequest={request => {
            if (request.url === 'about:blank') return true;
            if (request.url.startsWith(SCHOOL_ORIGIN + '/') || request.url === SCHOOL_ORIGIN) return true;
            if (/^https:\/\//.test(request.url)) void Linking.openURL(request.url).catch(() => {});
            return false;
          }}
          onNavigationStateChange={nav => {
            if (nav.url === SCHOOL_ORIGIN + '/login' || nav.url.startsWith(SCHOOL_ORIGIN + '/login?')) {
              void handleWebLogout();
            }
          }}
          onError={() => setWebError(true)}
          startInLoadingState
          renderLoading={() => <View style={styles.center}><ActivityIndicator color="#2563eb" /></View>}
        />
      )}
    </View>


  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ffffff', padding: 24 },
  loginScreen: { flexGrow: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  logo: { backgroundColor: '#2563eb', width: 76, height: 76, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  logoText: { color: '#fff', fontSize: 42, fontWeight: '800' },
  title: { color: '#fff', fontSize: 34, fontWeight: '800' },
  subtitle: { color: '#a9bad3', fontSize: 16, marginTop: 6, marginBottom: 36 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#162236', borderRadius: 20, padding: 22, gap: 14 },
  cardTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  input: { color: '#fff', borderRadius: 12, borderColor: '#3b4a63', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, backgroundColor: '#0b1220' },
  button: { backgroundColor: '#2563eb', paddingVertical: 15, paddingHorizontal: 22, alignItems: 'center', borderRadius: 12, marginTop: 5 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  webContainer: { flex: 1, backgroundColor: '#fff' },
  errorText: { color: '#192538', fontSize: 16, marginBottom: 20, textAlign: 'center' },
});
