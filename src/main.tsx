import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { DesktopAuthBridge } from './components/DesktopAuthBridge.tsx';
import './index.css';

const desktopAuthNonce =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('desktopAuth')
    : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {desktopAuthNonce ? <DesktopAuthBridge nonce={desktopAuthNonce} /> : <App />}
  </StrictMode>
);
