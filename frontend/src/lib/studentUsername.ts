import { ApiRequestError } from '../api/client';

type Language = 'RU' | 'DE';

export function askStudentUsername(current: string | null, language: Language): string | null {
  const de = language === 'DE';
  const value = window.prompt(
    de
      ? 'Neuer Login (3–60 Zeichen, lateinische Buchstaben, Zahlen, Punkt, _ oder -). Der bisherige Login wird ersetzt; das Passwort bleibt gleich.'
      : 'Новый логин (3–60 символов: латинские буквы, цифры, точка, _ или -). Старый логин перестанет действовать, пароль останется прежним.',
    current ?? '',
  );
  if (value === null || value.trim() === current) return null;
  const username = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,59}$/.test(username)) {
    window.alert(de
      ? 'Der Login muss mit einem lateinischen Buchstaben beginnen und 3–60 zulässige Zeichen enthalten.'
      : 'Логин должен начинаться с латинской буквы и содержать от 3 до 60 разрешённых символов.');
    return null;
  }
  return username;
}

export function studentUsernameError(error: unknown, language: Language): string {
  const de = language === 'DE';
  if (error instanceof ApiRequestError && error.status === 409) {
    return de ? 'Dieser Login ist bereits vergeben. Wähle einen anderen.' : 'Этот логин уже занят. Выберите другой.';
  }
  if (error instanceof ApiRequestError && error.status === 400) {
    return de ? 'Der Login ist ungültig.' : 'Недопустимый формат логина.';
  }
  return de ? 'Der Login konnte nicht geändert werden. Bitte versuche es erneut.' : 'Не удалось изменить логин. Попробуйте ещё раз.';
}
