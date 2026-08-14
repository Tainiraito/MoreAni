import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HomePage } from '@/pages/HomePage'
import { ProfilePage } from '@/pages/ProfilePage'
import { AppHeader } from '@/components/layout/AppHeader'
import { ContentDetailDialog } from '@/components/content/ContentDetailDialog'
import { AuthDialog } from '@/components/auth/AuthDialog'
import { SettingsDialog } from '@/components/settings/SettingsDialog'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-[#FAFAFA]">
          <AppHeader />
          <main>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/profile/:id" element={<ProfilePage />} />
            </Routes>
          </main>
        </div>

        {/* Global Dialogs */}
        <ContentDetailDialog />
        <AuthDialog />
        <SettingsDialog />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
