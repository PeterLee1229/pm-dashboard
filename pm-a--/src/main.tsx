import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ConsentPage from './components/ConsentPage.tsx'

// 前端沒有 router：/oauth/consent（AI 連線授權同意頁）以路徑判斷，其餘路徑維持原本的 App
const isConsentPage = window.location.pathname === '/oauth/consent'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConsentPage ? <ConsentPage /> : <App />}
  </StrictMode>,
)
