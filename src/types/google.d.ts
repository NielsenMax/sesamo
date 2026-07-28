/* Minimal typings for the two Google scripts Sésamo loads at runtime. */

declare namespace google {
  namespace accounts.oauth2 {
    interface TokenResponse {
      access_token?: string
      expires_in?: string | number
      scope?: string
      error?: string
      error_description?: string
    }
    interface TokenClient {
      requestAccessToken(overrides?: { prompt?: '' | 'none' | 'consent' | 'select_account'; hint?: string }): void
    }
    interface TokenClientConfig {
      client_id: string
      scope: string
      prompt?: '' | 'none' | 'consent' | 'select_account'
      callback: (response: TokenResponse) => void
      error_callback?: (error: { type?: string; message?: string }) => void
    }
    function initTokenClient(config: TokenClientConfig): TokenClient
    function revoke(token: string, done?: () => void): void
  }

  namespace picker {
    enum ViewId {
      SPREADSHEETS = 'spreadsheets',
    }
    enum Action {
      PICKED = 'picked',
      CANCEL = 'cancel',
    }
    enum Feature {
      NAV_HIDDEN = 'navHidden',
      SUPPORT_DRIVES = 'supportDrives',
    }
    class DocsView {
      constructor(viewId?: ViewId)
      setIncludeFolders(v: boolean): DocsView
      setSelectFolderEnabled(v: boolean): DocsView
      setMimeTypes(m: string): DocsView
      setOwnedByMe(v: boolean): DocsView
      setLabel(label: string): DocsView
    }
    class PickerBuilder {
      addView(view: DocsView | ViewId): PickerBuilder
      setOAuthToken(token: string): PickerBuilder
      setDeveloperKey(key: string): PickerBuilder
      setAppId(appId: string): PickerBuilder
      setTitle(title: string): PickerBuilder
      setCallback(cb: (data: PickerData) => void): PickerBuilder
      setLocale(locale: string): PickerBuilder
      enableFeature(feature: Feature): PickerBuilder
      build(): Picker
    }
    interface Picker {
      setVisible(visible: boolean): void
      dispose(): void
    }
    interface PickerDocument {
      id: string
      name: string
      mimeType: string
      url?: string
    }
    interface PickerData {
      action: Action | string
      docs?: PickerDocument[]
    }
  }
}

declare const gapi: {
  load(api: string, callback: () => void): void
}

interface Window {
  google?: typeof google
  gapi?: typeof gapi
}
