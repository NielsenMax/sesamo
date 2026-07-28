/*
  Google Picker.

  With the `drive.file` scope the app starts out able to see nothing. The Picker
  is how the user hands over one specific spreadsheet — Google grants access to
  exactly that file and nothing around it. It is the only way to open a sheet
  Sésamo didn't create itself.
*/
import { API_KEY, PROJECT_NUMBER, getToken } from './auth'

const GAPI_SRC = 'https://apis.google.com/js/api.js'

let gapiPromise: Promise<void> | null = null

function loadPicker(): Promise<void> {
  if (gapiPromise) return gapiPromise
  gapiPromise = new Promise<void>((resolve, reject) => {
    const start = () => {
      window.gapi!.load('picker', () => resolve())
    }
    if (window.gapi) return start()
    const el = document.createElement('script')
    el.src = GAPI_SRC
    el.async = true
    el.defer = true
    el.onload = start
    el.onerror = () => reject(new Error('Could not load the Google Picker'))
    document.head.appendChild(el)
  })
  return gapiPromise
}

export type PickedFile = { id: string; name: string }

/** Resolves with the chosen spreadsheet, or null if the user backed out. */
export async function pickSpreadsheet(locale: string): Promise<PickedFile | null> {
  const [token] = await Promise.all([getToken(), loadPicker()])

  return new Promise<PickedFile | null>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes('application/vnd.google-apps.spreadsheet')

    const builder = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setLocale(locale)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs?.[0]
          resolve(doc ? { id: doc.id, name: doc.name } : null)
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null)
        }
      })

    // Required for drive.file: without the app id Google can't attribute the
    // per-file grant to this client, and every later read comes back 403.
    if (PROJECT_NUMBER) builder.setAppId(PROJECT_NUMBER)

    builder.build().setVisible(true)
  })
}
