/** Carta Técnica Operacional: a aplicação é uma estação cartográfica, não um dashboard genérico. */
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import Home from '@/pages/Home'
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './contexts/ThemeContext'

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider><Toaster /><Home /></TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
