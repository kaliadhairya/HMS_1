import { useTheme } from '../context/ThemeContext';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  
  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      <div className="theme-toggle__stars">
        <div className="theme-toggle__star"></div>
        <div className="theme-toggle__star"></div>
        <div className="theme-toggle__star"></div>
      </div>
      
      <div className="theme-toggle__clouds">
        <div className="theme-toggle__cloud"></div>
        <div className="theme-toggle__cloud"></div>
      </div>
      
      <div className="theme-toggle__knob">
        <div className="theme-toggle__sun"></div>
        <div className="theme-toggle__moon"></div>
      </div>
    </button>
  );
}
