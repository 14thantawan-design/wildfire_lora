/** จุดเริ่มต้นของ React: นำ App ไปวาดภายใน element id="root" ของ index.html */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
