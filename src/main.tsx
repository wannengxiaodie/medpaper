import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ThemeProvider } from 'next-themes'
import './index.css'
import App from './App.tsx'
import FluidBackground from './components/FluidBackground.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="medpaper.theme">
      <BrowserRouter>
        <FluidBackground />
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
