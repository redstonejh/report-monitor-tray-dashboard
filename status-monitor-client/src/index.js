import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './App.css';
import './liquid-glass-webgl.js';
import './glass-backdrop.js';

createRoot(document.getElementById('root')).render(<App />);
