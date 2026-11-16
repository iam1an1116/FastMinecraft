import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Global Ripple Effect for all buttons, links, and clickable items
document.addEventListener('pointerdown', (e) => {
  const target = (e.target as HTMLElement).closest(
    'button, a, [role="button"], input[type="button"], .interactive-ripple'
  ) as HTMLElement;

  if (!target) return;

  target.classList.add('ripple-host');

  const rect = target.getBoundingClientRect();
  const diameter = Math.max(rect.width, rect.height) * 2;
  const x = e.clientX - rect.left - diameter / 2;
  const y = e.clientY - rect.top - diameter / 2;

  const wave = document.createElement('span');
  wave.className = 'ripple-wave';
  wave.style.width = `${diameter}px`;
  wave.style.height = `${diameter}px`;
  wave.style.left = `${x}px`;
  wave.style.top = `${y}px`;

  target.appendChild(wave);

  setTimeout(() => {
    wave.remove();
  }, 550);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
