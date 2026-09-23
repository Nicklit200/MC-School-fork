import { Component, type ErrorInfo, type ReactNode } from 'react';

export class OnlineClassErrorBoundary extends Component<
  { children: ReactNode; onBack?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Online class render failed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ minHeight: '65vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div className="panel" style={{ width: 'min(720px, 100%)', padding: 28 }}>
          <h2 style={{ marginTop: 0 }}>Урок не отобразился</h2>
          <p>
            Соединение с уроком создано, но интерфейс доски завершился с ошибкой.
            Обнови страницу. Если ошибка повторится, пришли текст ниже.
          </p>
          <div
            style={{
              margin: '14px 0',
              padding: 12,
              borderRadius: 10,
              background: '#fff7ed',
              overflowWrap: 'anywhere',
              fontFamily: 'monospace',
              fontSize: 13,
            }}
          >
            {this.state.error.message || String(this.state.error)}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => window.location.reload()}>
              Обновить урок
            </button>
            {this.props.onBack && (
              <button className="btn btn--secondary" type="button" onClick={this.props.onBack}>
                Назад к урокам
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
