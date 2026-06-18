import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import LegendWindow from './components/LegendWindow';
import './App.css';
import './liquid-glass-webgl.js';
import './glass-backdrop.js';

// The same renderer bundle serves both windows; ?legend=1 (set by main when it
// opens the separate legend window) renders just the legend card.
const isLegend = new URLSearchParams(window.location.search).get('legend') === '1';
createRoot(document.getElementById('root')).render(isLegend ? <LegendWindow /> : <App />);
