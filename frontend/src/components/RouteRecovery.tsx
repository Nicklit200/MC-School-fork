import { Component, type ReactNode } from 'react';

function isGerman() {
  try { return localStorage.getItem('language') === 'DE'; } catch { return false; }
}

export function PageLoading() {
  return <main role="status" aria-live="polite" style={{ padding: 24 }}>
    <p>{isGerman() ? 'Seite wird geladen…' : 'Загружаем страницу…'}</p>
  </main>;
}

export class RouteErrorBoundary extends Component<{ routeKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: Readonly<{ routeKey: string; children: ReactNode }>) {
    if (this.state.failed && previous.routeKey !== this.props.routeKey) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const de = isGerman();
    return <main className="panel" role="alert" style={{ maxWidth: 560, margin: '48px auto', padding: 24 }}>
      <h1>{de ? 'Seite konnte nicht geöffnet werden' : 'Не удалось открыть страницу'}</h1>
      <p>{de ? 'Bitte lade die Seite erneut. Deine Anmeldung bleibt erhalten.' : 'Обновите страницу и попробуйте снова. Вход в аккаунт сохранится.'}</p>
      <button className="btn" type="button" onClick={() => window.location.reload()}>
        {de ? 'Seite neu laden' : 'Обновить страницу'}
      </button>
    </main>;
  }
}
