import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Landing } from './views/Landing'
import { NewEvent } from './views/NewEvent'
import { EventShell } from './views/EventShell'
import { Tickets } from './views/Tickets'
import { Log } from './views/Log'
import { EventSettings } from './views/EventSettings'
import { Spinner } from './components/ui'

/*
  The PDF engine and the QR decoder are large and only two screens need them.
  Splitting them keeps the first load light on a phone at the door; the service
  worker precaches every chunk, so going offline later costs nothing.
*/
const Design = lazy(() => import('./views/Design').then((m) => ({ default: m.Design })))
const Scanner = lazy(() => import('./views/Scanner').then((m) => ({ default: m.Scanner })))

export function App() {
  return (
    <Suspense fallback={<div className="strip" style={{ paddingTop: '4rem' }}><Spinner /></div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/new" element={<NewEvent />} />
        <Route path="/e/:spreadsheetId" element={<EventShell />}>
          <Route index element={<Navigate to="tickets" replace />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="design" element={<Design />} />
          <Route path="scan" element={<Scanner />} />
          <Route path="log" element={<Log />} />
          <Route path="settings" element={<EventSettings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
