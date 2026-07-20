import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/workspace.css';
import App from './App';
import { LoginPage } from './components/LoginPage';
import { bootstrapAuth } from './auth/bootstrap';

// Auth primeiro: conclui callbacks (federação / setup do GitHub App) e, sem
// sessão, renderiza a tela de login própria (design SpecWave) no lugar do App.
bootstrapAuth().then((mode) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>{mode === 'app' ? <App /> : <LoginPage />}</StrictMode>,
  );
});
