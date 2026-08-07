import { createRoot } from 'react-dom/client';
import App, { AppErrorBoundary } from './App';
import { registerServiceWorker } from './pwa';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('BumpCompanion could not find its app container.');

createRoot(rootElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

registerServiceWorker();
