import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, useWindowDimensions, View,
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
  const [language, setLanguage] = useState<'RU' | 'DE'>('RU');
  const [showPassword, setShowPassword] = useState(false);
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 700;
  const isShortScreen = height < 660;
  const de = language === 'DE';

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
      Alert.alert('Mindcrafti', de ? 'Bitte gib deinen Login und dein Passwort ein.' : 'Введите логин и пароль от школы.');
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
      <StatusBar barStyle="dark-content" />
      <View pointerEvents="none" style={[styles.decorRing, styles.decorRingTop]} />
      <View pointerEvents="none" style={[styles.decorRing, styles.decorRingBottom]} />
      <View pointerEvents="none" style={[styles.decorDots, styles.decorDotsTop]}>
        {Array.from({ length: 25 }, (_, i) => <View key={i} style={styles.decorDot} />)}
      </View>
      <View pointerEvents="none" style={[styles.decorDots, styles.decorDotsBottom]}>
        {Array.from({ length: 25 }, (_, i) => <View key={i} style={styles.decorDot} />)}
      </View>

      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.loginScroll}
          contentContainerStyle={[styles.loginScreen, isShortScreen && styles.loginScreenShort]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.brand, isTablet ? styles.brandTablet : styles.brandPhone]}>
            <View style={styles.logo}><Text style={styles.logoText}>M</Text></View>
            <Text style={[styles.brandName, !isTablet && styles.brandNamePhone]}>
              <Text style={styles.brandAccent}>MindCrafti</Text> School
            </Text>
          </View>

          <View style={[styles.loginCard, isTablet ? styles.loginCardTablet : styles.loginCardPhone]}>
            <Text style={[styles.loginTitle, !isTablet && styles.loginTitlePhone]}>{de ? 'Anmeldung' : 'Вход'}</Text>
            <Text style={styles.loginSubtitle}>
              {de ? 'Melde dich an, um in der Schule weiterzuarbeiten.' : 'Войдите, чтобы продолжить работу в системе'}
            </Text>

            <Text style={styles.fieldLabel}>{de ? 'Login oder E-Mail' : 'Логин или email'}</Text>
            <TextInput
              style={styles.input}
              placeholder={de ? 'z. B. Mark124' : 'например Марк124'}
              placeholderTextColor="#8e97a6"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              value={loginId}
              onChangeText={setLoginId}
              returnKeyType="next"
              accessibilityLabel={de ? 'Login oder E-Mail' : 'Логин или email'}
            />

            <Text style={[styles.fieldLabel, styles.passwordLabel]}>{de ? 'Passwort' : 'Пароль'}</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder=""
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => { if (!working) void login(); }}
                returnKeyType="done"
                accessibilityLabel={de ? 'Passwort' : 'Пароль'}
              />
              <Pressable
                style={styles.passwordToggle}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? (de ? 'Passwort verbergen' : 'Скрыть пароль') : (de ? 'Passwort anzeigen' : 'Показать пароль')}
                onPress={() => setShowPassword(current => !current)}
              >
                <Text style={styles.passwordToggleText}>{showPassword ? '◉' : '◎'}</Text>
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [styles.loginButton, (pressed || working) && styles.loginButtonPressed]}
              disabled={working}
              onPress={() => { void login(); }}
              accessibilityRole="button"
            >
              {working
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.loginButtonText}>{de ? 'Anmelden' : 'Войти'}</Text>}
            </Pressable>

            <Pressable
              style={styles.activationLink}
              accessibilityRole="link"
              onPress={() => { void Linking.openURL(SCHOOL_ORIGIN + '/activate').catch(() => {}); }}
            >
              <Text style={styles.activationLinkText}>{de ? 'Passwort festlegen' : 'Установите пароль'}</Text>
            </Pressable>

            <View style={styles.languageSwitch}>
              <Pressable
                onPress={() => setLanguage('RU')}
                accessibilityRole="button"
                accessibilityState={{ selected: !de }}
                style={[styles.languageButton, !de && styles.languageButtonActive]}
              >
                <Text style={[styles.languageButtonText, !de && styles.languageButtonTextActive]}>Русский</Text>
              </Pressable>
              <Pressable
                onPress={() => setLanguage('DE')}
                accessibilityRole="button"
                accessibilityState={{ selected: de }}
                style={[styles.languageButton, de && styles.languageButtonActive]}
              >
                <Text style={[styles.languageButtonText, de && styles.languageButtonTextActive]}>Немецкий</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
          source={{ uri: SCHOOL_ORIGIN + (
            user.role === 'PARENT' ? '/parent'
              : user.role === 'TEACHER' ? '/students'
                : user.role === 'STUDENT' ? '/today' : '/teachers'
          ) + '?mobileRefresh=20261127-ipad-teacher' }}
          cacheEnabled={false}
          originWhitelist={[SCHOOL_ORIGIN]}
          injectedJavaScriptBeforeContentLoaded={bootstrap}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          // The iPad teacher classroom uses LiveKit getUserMedia inside WKWebView.
          // iOS prompts on first use, then reuses the approved same-host grant.
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsBackForwardNavigationGestures
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          autoManageStatusBarEnabled={false}
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
  // Match frontend/src/login-page.css: white/off-white backdrop, orange mark,
  // white outlined card, navy typography and orange primary actions.
  root: { flex: 1, backgroundColor: '#fffaf7' },
  keyboard: { flex: 1 },
  loginScroll: { flex: 1, zIndex: 1 },
  loginScreen: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 30,
  },
  loginScreenShort: { justifyContent: 'flex-start', paddingVertical: 18 },
  decorRing: { position: 'absolute', borderColor: '#ffede3', borderStyle: 'solid' },
  decorRingTop: {
    width: 270, height: 270, borderRadius: 135, borderWidth: 32,
    left: -145, top: -132,
  },
  decorRingBottom: {
    width: 400, height: 240, borderRadius: 190, borderWidth: 1,
    right: -110, bottom: -160, backgroundColor: '#fff2ea',
    transform: [{ rotate: '-18deg' }],
  },
  decorDots: {
    position: 'absolute', width: 66, height: 66,
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, opacity: 0.55,
  },
  decorDotsTop: { top: 8, right: 22 },
  decorDotsBottom: { left: 5, bottom: 20 },
  decorDot: { width: 2, height: 2, borderRadius: 1, backgroundColor: '#ffb487' },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  brandTablet: { marginBottom: 26 },
  brandPhone: { marginBottom: 20 },
  logo: {
    backgroundColor: '#ff5b00', width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#ff5b00', shadowOpacity: 0.2, shadowRadius: 14, elevation: 4,
  },
  logoText: { color: '#fff', fontSize: 27, fontWeight: '800' },
  brandName: { color: '#172033', fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  brandNamePhone: { fontSize: 22 },
  brandAccent: { color: '#ff5b00' },
  loginCard: {
    width: '100%', maxWidth: 665, backgroundColor: '#fff', borderColor: '#ffdcca',
    borderWidth: 1, shadowColor: '#422614', shadowOpacity: 0.08, shadowRadius: 28,
    shadowOffset: { width: 0, height: 15 }, elevation: 3,
  },
  loginCardTablet: { borderRadius: 28, paddingHorizontal: 44, paddingTop: 37, paddingBottom: 33 },
  loginCardPhone: { borderRadius: 23, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 30 },
  loginTitle: { fontSize: 39, lineHeight: 46, fontWeight: '800', color: '#14203a', letterSpacing: -0.8 },
  loginTitlePhone: { fontSize: 35, lineHeight: 41 },
  loginSubtitle: { color: '#6d7890', fontSize: 14, marginTop: 6, marginBottom: 29 },
  fieldLabel: { color: '#2d3951', fontSize: 15, marginBottom: 8, fontWeight: '500' },
  passwordLabel: { marginTop: 16 },
  input: {
    height: 53, borderWidth: 1, borderColor: '#d6dce7', borderRadius: 10,
    paddingHorizontal: 14, backgroundColor: '#fff', color: '#152039', fontSize: 16,
  },
  passwordWrap: { justifyContent: 'center' },
  passwordInput: { paddingRight: 58 },
  passwordToggle: {
    position: 'absolute', right: 8, top: 5, width: 43, height: 43,
    alignItems: 'center', justifyContent: 'center', borderRadius: 9,
  },
  passwordToggleText: { color: '#617089', fontSize: 24 },
  loginButton: {
    height: 56, borderRadius: 11, backgroundColor: '#ff5b00', marginTop: 19,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#ff5b00', shadowOpacity: 0.15, shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 }, elevation: 2,
  },
  loginButtonPressed: { opacity: 0.76 },
  loginButtonText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  activationLink: { alignSelf: 'center', paddingVertical: 15, marginTop: 4 },
  activationLinkText: {
    fontSize: 15, fontWeight: '700', color: '#ff5b00',
    textDecorationLine: 'underline',
  },
  languageSwitch: { flexDirection: 'row', justifyContent: 'center', gap: 9, marginTop: 4 },
  languageButton: {
    minWidth: 108, height: 39, paddingHorizontal: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#dbe1ea', borderRadius: 9, backgroundColor: '#fff',
  },
  languageButtonActive: { borderColor: '#ffcbae', backgroundColor: '#fff4ee' },
  languageButtonText: { color: '#5f6a80', fontSize: 14, fontWeight: '600' },
  languageButtonTextActive: { color: '#ff5b00' },
  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#fff', padding: 24,
  },
  button: {
    backgroundColor: '#ff5b00', paddingVertical: 15, paddingHorizontal: 22,
    alignItems: 'center', borderRadius: 12, marginTop: 5,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  webContainer: { flex: 1, backgroundColor: '#fff' },
  errorText: { color: '#192538', fontSize: 16, marginBottom: 20, textAlign: 'center' },
});
