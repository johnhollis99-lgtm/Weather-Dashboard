import { useEffect, useRef, useState } from 'react';

// Shared wrapper for third-party <iframe> embeds (Windy, Caltrans, NDOT).
//
// Why this exists: a cross-origin iframe cannot tell us it failed. `onError`
// never fires for framing refusals, and a frame blocked by X-Frame-Options /
// CSP still fires `onLoad` (for the browser's own error document). Previously
// every embed here was a bare <iframe>, so any failure rendered as an
// unexplained blank rectangle — the exact silent-failure case we want gone.
//
// What we can honestly detect is "onLoad never fired within a sensible window",
// which covers the common outages (host unreachable, proxy 502, network
// blocked). That becomes a real, named error state. Because the blocked-frame
// case is genuinely undetectable, we ALSO keep a permanent escape hatch under
// every embed telling the reader what to do when the box is blank. We never
// claim the embed rendered — only that the document reported loading.
const LOAD_TIMEOUT_MS = 12000;

export default function EmbedFrame({
  src,
  title,
  // Where "open the real thing" points when the embed is unusable.
  externalUrl,
  externalLabel = 'Open full site ↗',
  // Extra explanation shown under a healthy embed (e.g. proxy caveats).
  note,
  className = 'road-frame',
  allow,
}) {
  // 'idle' (offscreen, not started) → 'loading' → 'loaded' | 'timeout'
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);
  const wrapRef = useRef(null);

  // Reset whenever the embed target changes — a new city must not inherit the
  // previous frame's verdict.
  useEffect(() => {
    clearTimeout(timer.current);
    setStatus('idle');
  }, [src]);

  // Only judge a frame that actually got a chance to load. These iframes are
  // loading="lazy" and can sit inside a collapsed section, so a timer started
  // on mount would fire against a frame the browser never even requested and
  // report a false failure. Start the clock when the embed becomes visible.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || status !== 'idle') return;
    if (typeof IntersectionObserver === 'undefined') {
      setStatus('loading'); // no observer support — fall back to timing on mount
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStatus((s) => (s === 'idle' ? 'loading' : s));
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [status, src]);

  // Run the failure clock only while genuinely loading.
  useEffect(() => {
    if (status !== 'loading') return;
    timer.current = setTimeout(() => {
      setStatus((s) => (s === 'loading' ? 'timeout' : s));
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer.current);
  }, [status, src]);

  const onLoad = () => {
    clearTimeout(timer.current);
    setStatus('loaded');
  };

  if (status === 'timeout') {
    return (
      <div className="embed-fallback" ref={wrapRef}>
        <div className="state error">
          ⚠ {title} didn’t load within {LOAD_TIMEOUT_MS / 1000}s — the provider may be down, blocking
          embedding, or unreachable from this network.
        </div>
        <div className="link-row">
          <a className="link-cta" href={externalUrl} target="_blank" rel="noreferrer">
            {externalLabel}
          </a>
          <button type="button" onClick={() => setStatus('loading')}>
            ↻ Retry embed
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="embed-wrap" ref={wrapRef}>
        {status !== 'loaded' && (
          <div className="embed-loading">
            <span className="spinner" /> Loading {title}…
          </div>
        )}
        <iframe
          key={src}
          title={title}
          src={src}
          className={className}
          onLoad={onLoad}
          loading="lazy"
          allow={allow}
          frameBorder="0"
        />
      </div>
      <div className="obs-note">
        {note ? <>{note} </> : null}
        Embedded from the provider — if the map area is blank, they’re blocking embedding from here;{' '}
        <a href={externalUrl} target="_blank" rel="noreferrer">
          {externalLabel}
        </a>
      </div>
    </>
  );
}
