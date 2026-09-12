import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/production.css';

createRoot(document.getElementById('root')!).render(<App />);
