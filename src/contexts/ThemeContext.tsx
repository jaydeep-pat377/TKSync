import React, {createContext, useContext, useState, useMemo} from 'react';
import {Colors, DarkColors} from '../constants/colors';

type ColorSet = {[K in keyof typeof Colors]: string};

type ThemeContextType = {
  isDark: boolean;
  toggle: () => void;
  c: ColorSet;
};

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  toggle: () => {},
  c: Colors,
});

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [isDark, setIsDark] = useState(false);
  const value = useMemo(
    () => ({
      isDark,
      toggle: () => setIsDark(prev => !prev),
      c: isDark ? DarkColors : Colors,
    }),
    [isDark],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
