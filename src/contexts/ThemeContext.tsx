import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const STORAGE_KEY = 'theme';

// localStorage can throw (Safari private mode, blocked cookies) – never let that crash the app.
function readSaved(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null; // validate instead of trusting a cast
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Keep <html> classes mutually exclusive (the old code left "light" next to "dark"). */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readSaved() ?? systemTheme());
  const [hasExplicitChoice, setHasExplicitChoice] = useState(() => readSaved() !== null);

  useEffect(() => {
    applyTheme(theme);
    if (hasExplicitChoice) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        /* ignore */
      }
    }
  }, [theme, hasExplicitChoice]);

  // Follow the OS setting until the user picks a theme themselves.
  useEffect(() => {
    if (hasExplicitChoice) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setThemeState(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [hasExplicitChoice]);

  // When embedded in an iframe the parent can push a theme via postMessage (see index.html);
  // mirror it into React state so components such as the PDF viewer follow along.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const t = event.data?.theme;
      if (t === 'light' || t === 'dark') setThemeState(t);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setHasExplicitChoice(true);
    setThemeState(t);
  }, []);
  const toggleTheme = useCallback(() => {
    setHasExplicitChoice(true);
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme, setTheme }), [theme, toggleTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
