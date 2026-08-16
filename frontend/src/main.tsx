import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 清理残留 Service Worker
// 历史遗留的 COI (Cross-Origin Isolation) SW 会拦截 fetch 并尝试重建 Response，
// 而 DELETE 的 204 No Content 响应（null body）无法构造带 body 的 Response → 抛错 → 删除失败。
// 本项目不需要任何 Service Worker。
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => registration.unregister())
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
