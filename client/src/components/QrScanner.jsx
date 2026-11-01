import { useEffect, useRef } from 'react';
import QrScanner from 'qr-scanner';

export default function Scanner({ onResult, onError }) {
  const ref = useRef(null);
  const cb = useRef({ onResult, onError });
  cb.current = { onResult, onError };
  useEffect(() => {
    const sc = new QrScanner(ref.current, (r) => cb.current.onResult(r.data), { preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8, returnDetailedScanResult: true });
    sc.start().catch((e) => cb.current.onError?.(String(e?.message || e)));
    return () => { sc.stop(); sc.destroy(); };
  }, []);
  return <video ref={ref} muted playsInline className="w-full aspect-square object-cover rounded-2xl bg-black" />;
}
