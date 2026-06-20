import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { startUpdateCheck } from './updateCheck';
import './index.css';
import './theme.css';
import './list-screens.css';

const queryClient = new QueryClient();

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    void Promise.all(registrations.map((registration) => registration.unregister()));
  });
}

startUpdateCheck();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
