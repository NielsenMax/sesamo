import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

/*
  Camera plumbing for the door.

  Chromium phones have a native barcode detector that runs on the GPU and costs
  nothing; everything else falls back to jsQR over a downscaled canvas at ~10
  frames a second, which is plenty for someone holding a phone up to a ticket
  and far kinder to the battery than decoding every frame.
*/

export type CameraError = 'denied' | 'missing' | null

const FALLBACK_FPS = 10
const WORK_SIZE = 480

export function useScanner({ active, onCode }: { active: boolean; onCode: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  const [error, setError] = useState<CameraError>(null)
  const [ready, setReady] = useState(false)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setReady(false)
    setTorchOn(false)
  }, [])

  useEffect(() => {
    if (!active) {
      stop()
      return
    }
    let cancelled = false
    let detector: BarcodeDetector | null = null

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('missing')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        setError(null)
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => undefined)
        }
        const track = stream.getVideoTracks()[0]
        setTorchAvailable(Boolean(track?.getCapabilities?.().torch))
        setReady(true)

        if (window.BarcodeDetector) {
          try {
            const formats = await BarcodeDetector.getSupportedFormats()
            if (formats.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] })
          } catch {
            detector = null
          }
        }
        loop()
      } catch (err) {
        if (cancelled) return
        const name = err instanceof DOMException ? err.name : ''
        setError(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' : 'denied')
      }
    }

    function loop() {
      rafRef.current = requestAnimationFrame(loop)
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      const now = performance.now()
      if (!detector && now - lastRef.current < 1000 / FALLBACK_FPS) return
      lastRef.current = now

      if (detector) {
        void detector
          .detect(video)
          .then((codes) => codes[0] && onCodeRef.current(codes[0].rawValue))
          .catch(() => undefined)
        return
      }

      const canvas = (canvasRef.current ??= document.createElement('canvas'))
      const scale = Math.min(1, WORK_SIZE / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      if (!canvas.width || !canvas.height) return
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
      if (found?.data) onCodeRef.current(found.data)
    }

    void start()
    return () => {
      cancelled = true
      stop()
    }
  }, [active, facing, stop])

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] })
      setTorchOn(next)
    } catch {
      setTorchAvailable(false)
    }
  }, [torchOn])

  const switchCamera = useCallback(() => setFacing((f) => (f === 'environment' ? 'user' : 'environment')), [])

  return { videoRef, error, ready, torchOn, torchAvailable, toggleTorch, switchCamera }
}
