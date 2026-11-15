import { perfMark } from './services/perf'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './fonts.css'
import './styles/globals.css'
perfMark('renderer:modules-evaluated')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
