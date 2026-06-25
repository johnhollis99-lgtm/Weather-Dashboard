import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_SYSTEM } from './units.js';

// App-wide display unit system ('imperial' | 'metric'). Imperial is the default
// (US audience). The choice is display-only — all physics stays SI — and is
// persisted so it survives reloads. See src/lib/units.js for the registry.
const STORAGE_KEY = 'wx.unitSystem';

const UnitsContext = createContext({
  system: DEFAULT_SYSTEM,
  setSystem: () => {},
  toggle: () => {},
});

function readInitial() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'imperial' || v === 'metric') return v;
  } catch {
    /* localStorage unavailable (private mode, etc.) — fall through to default */
  }
  return DEFAULT_SYSTEM;
}

export function UnitsProvider({ children }) {
  const [system, setSystemState] = useState(readInitial);

  const setSystem = useCallback((s) => {
    setSystemState(s === 'metric' ? 'metric' : 'imperial');
  }, []);
  const toggle = useCallback(() => {
    setSystemState((s) => (s === 'imperial' ? 'metric' : 'imperial'));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, system);
    } catch {
      /* ignore persistence failures */
    }
  }, [system]);

  return (
    <UnitsContext.Provider value={{ system, setSystem, toggle }}>{children}</UnitsContext.Provider>
  );
}

export function useUnits() {
  return useContext(UnitsContext);
}
