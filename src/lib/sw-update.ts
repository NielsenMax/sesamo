/*
  Picking up a new deployment.

  The service worker precaches index.html, so a returning visitor is served the
  build they already have and only sees a new one on the visit *after* the
  deploy. That is how a fix can be live and still not be what your phone runs.

  When the new worker takes control we reload — except at the door. Yanking the
  page out from under someone mid-scan to deliver an update is the wrong trade
  every time; the door keeps the build it has until whoever is holding it
  navigates away.
*/

let refreshing = false

export function reloadOnNewVersion() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    if (window.location.pathname.endsWith('/scan')) return
    refreshing = true
    window.location.reload()
  })
}
