import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';

window.onerror = function (msg, url, lineNo, columnNo, error) {
    const root = document.getElementById('root');
    if (root && (!root.innerHTML || root.innerHTML === '')) {
        root.innerHTML = '<div style="padding: 20px; color: red; background: #fff5f5; border: 1px solid red; margin: 20px; border-radius: 8px;">' +
            '<h1 style="margin-top:0">Frontend Error Detected</h1>' +
            '<p><strong>Message:</strong> ' + msg + '</p>' +
            '<p><strong>File:</strong> ' + url + '</p>' +
            '<p><strong>Line:</strong> ' + lineNo + '</p>' +
            '<pre style="white-space: pre-wrap; margin-top: 10px; font-size: 12px; background: #fee; padding: 10px;">' + (error ? error.stack : 'No stack trace') + '</pre>' +
            '</div>';
    }
    return false;
};

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);