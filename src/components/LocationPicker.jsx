import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '../lib/locations.js';
import { searchPlaces } from '../api/geocoding.js';

// Preset dropdown + free-text place search (Open-Meteo geocoding).
export default function LocationPicker({ location, onChange }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef(null);

  // Debounced search.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchPlaces(query);
        setResults(r);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    const h = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const presetMatch = PRESETS.find((p) => p.name === location.name);

  return (
    <>
      <select
        value={presetMatch ? location.name : ''}
        onChange={(e) => {
          const p = PRESETS.find((x) => x.name === e.target.value);
          if (p) onChange(p);
        }}
      >
        {!presetMatch && <option value="">{location.name} (custom)</option>}
        {PRESETS.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>

      <div className="search-wrap" ref={boxRef}>
        <input
          type="text"
          placeholder="Search any place…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
        {open && (results.length > 0 || searching) && (
          <div className="search-results">
            {searching && <div>Searching…</div>}
            {results.map((r) => (
              <div
                key={`${r.lat},${r.lon}`}
                onClick={() => {
                  onChange({ name: r.label, lat: r.lat, lon: r.lon });
                  setQuery('');
                  setResults([]);
                  setOpen(false);
                }}
              >
                {r.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
