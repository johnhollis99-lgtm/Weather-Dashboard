import { useCallback, useId, useState } from 'react';

// A dashboard section: a real landmark, not just bigger text.
//
// Renders <section aria-labelledby> + a heading, so screen readers and
// keyboard users get the same structure sighted readers get from the rule and
// the eyebrow label. Heavy blocks (imagery, travel) pass `collapsible` so the
// top of the page stays scannable; that state persists per-section so a refresh
// doesn't reopen what you closed.
export default function Section({
  id,
  title,
  kicker,
  note,
  children,
  collapsible = false,
  defaultOpen = true,
}) {
  const headingId = useId();
  const storageKey = `wx.section.${id}`;

  const [open, setOpen] = useState(() => {
    if (!collapsible) return true;
    try {
      const v = localStorage.getItem(storageKey);
      return v == null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* private mode — collapse still works, just isn't remembered */
      }
      return next;
    });
  }, [storageKey]);

  return (
    <section className="wx-section" id={id} aria-labelledby={headingId}>
      <div className="wx-section-head">
        <div className="wx-section-heading">
          <h2 className="wx-section-title" id={headingId}>
            {title}
          </h2>
          {kicker && <span className="wx-section-kicker">{kicker}</span>}
        </div>
        {note && <p className="wx-section-note">{note}</p>}
        {collapsible && (
          <button
            type="button"
            className="wx-section-toggle"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={`${id}-body`}
          >
            {open ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      <div className="grid" id={`${id}-body`} hidden={collapsible && !open}>
        {children}
      </div>
    </section>
  );
}
