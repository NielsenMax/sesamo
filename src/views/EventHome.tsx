import { Navigate } from 'react-router-dom'

/**
 * Opening an event lands on the ticket list at a desk and on the door screen on
 * a handheld — because a phone with Sésamo open is almost certainly being held
 * up to somebody's ticket.
 *
 * Three independent signals, any one of which is enough. A single compound
 * media query looked tidy but had to be right about both halves at once: an
 * iPad Pro in landscape is 1366 CSS pixels wide and still very much a door
 * device, and a browser in desktop-site mode lies about the pointer. Being
 * wrong here costs one tap, so the check leans towards the scanner.
 */
function isHandheld(): boolean {
  if (typeof window === 'undefined') return false
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const cannotHover = window.matchMedia('(hover: none)').matches
  const touchAndSmall =
    navigator.maxTouchPoints > 0 && window.matchMedia('(max-width: 1024px)').matches
  return coarsePointer || cannotHover || touchAndSmall
}

export function EventHome() {
  return <Navigate to={isHandheld() ? 'scan' : 'tickets'} replace />
}
