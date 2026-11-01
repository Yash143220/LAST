import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/barlow/400.css';
import './styles.css';
import App from './App.jsx';
import { SessionProvider } from './lib/session.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode><BrowserRouter><SessionProvider><App /></SessionProvider></BrowserRouter></StrictMode>
);
