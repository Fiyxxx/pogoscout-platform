import '@fontsource-variable/archivo/wdth.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/tokens.css'
import './styles/app.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { CellPage } from './pages/CellPage'
import { DemoPage } from './pages/DemoPage'
import { MissionPage } from './pages/MissionPage'
import { MissionsPage } from './pages/MissionsPage'
import { ModelPage } from './pages/ModelPage'
import { WorldPage } from './pages/WorldPage'
import { installViewportScale } from './lib/viewportScale'

installViewportScale()

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2_000, refetchOnWindowFocus: false } },
})

const router = createBrowserRouter([
  { path: '/', element: <WorldPage /> },
  { path: '/missions', element: <MissionsPage /> },
  { path: '/3d', element: <ModelPage /> },
  { path: '/demo', element: <DemoPage /> },
  { path: '/missions/:missionId', element: <MissionPage /> },
  { path: '/missions/:missionId/cells/:x/:y', element: <CellPage /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
