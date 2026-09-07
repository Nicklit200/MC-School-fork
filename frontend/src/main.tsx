import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { I18nProvider } from './i18n/I18nContext';
import './index.css';
import './teacher-groups.css';
import './teacher-detail.css';
import './group-detail.css';
import './login-page.css';
import './pdf-homework.css';
import './student-menu.css';
import './student-today-status.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* I18nProvider wraps AuthProvider because auth sets the language on login. */}
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
