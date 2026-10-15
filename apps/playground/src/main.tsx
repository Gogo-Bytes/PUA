import React from 'react';
import ReactDOM from 'react-dom/client';
import { Production } from './Production';
import { App } from './App';
import { Standalone } from './Standalone';
import { StateGallery } from './StateGallery';
import '@pua/components/styles.css';
import './styles.css';
import './state-gallery.css';

const view = new URLSearchParams(window.location.search).get('view');
const Page = view === 'production' ? Production : view === 'isolated' ? Standalone : view === 'interactive' ? App : StateGallery;
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Page /></React.StrictMode>);
