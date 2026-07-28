/* Shape-detection and torch APIs: shipped in Chromium, absent from lib.dom. */

interface DetectedBarcode {
  rawValue: string
  format: string
}

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] })
  static getSupportedFormats(): Promise<string[]>
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector
}

interface MediaTrackCapabilities {
  torch?: boolean
}

interface MediaTrackConstraintSet {
  torch?: boolean
}
