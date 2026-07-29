import { Navigate } from 'react-router-dom'

/**
 * Opening an event lands on the ticket list at a desk and on the door screen on
 * a handheld — because a phone that has Sésamo open at all is almost certainly
 * being held up to somebody's ticket.
 *
 * `pointer: coarse` is the signal, not screen width: a narrow desktop window is
 * still a desk, and a tablet at the door is still the door. Touchscreen laptops
 * report a fine primary pointer, so they stay on the ticket list too.
 */
function isHandheld(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse) and (max-width: 1024px)').matches
}

export function EventHome() {
  return <Navigate to={isHandheld() ? 'scan' : 'tickets'} replace />
}
