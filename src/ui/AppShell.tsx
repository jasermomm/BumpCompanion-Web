import { Gauge, Home, MapPin, Route, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { classNames } from './utils';

export type AppTab = 'home' | 'bumps' | 'drives' | 'settings';

const TABS = [
  { id: 'home' as const, label: 'Home', icon: Home },
  { id: 'bumps' as const, label: 'Bumps', icon: Gauge },
  { id: 'drives' as const, label: 'Drives', icon: Route },
  { id: 'settings' as const, label: 'Settings', icon: Settings }
];

export interface AppShellProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  children: ReactNode;
  showNavigation?: boolean;
  driveActive?: boolean;
  brandIconSrc?: string;
}

export function AppShell({
  activeTab,
  onTabChange,
  children,
  showNavigation = true,
  driveActive = false,
  brandIconSrc = `${import.meta.env.BASE_URL}icons/icon-192.png`
}: AppShellProps) {
  return (
    <div className={classNames('bc-app-shell', !showNavigation && 'bc-app-shell--detail')}>
      {showNavigation ? (
        <aside className="bc-desktop-rail" aria-label="BumpCompanion navigation">
          <div className="bc-desktop-brand">
            <img src={brandIconSrc} alt="" width="44" height="44" />
            <span>BumpCompanion</span>
          </div>
          <ShellNavigation activeTab={activeTab} onTabChange={onTabChange} driveActive={driveActive} />
          <div className="bc-desktop-rail__local"><MapPin aria-hidden="true" size={17} /> Stored on this device</div>
        </aside>
      ) : null}
      <main className="bc-app-content">{children}</main>
      {showNavigation ? (
        <nav className="bc-bottom-nav" aria-label="BumpCompanion navigation">
          <ShellNavigation activeTab={activeTab} onTabChange={onTabChange} driveActive={driveActive} />
        </nav>
      ) : null}
    </div>
  );
}

function ShellNavigation({
  activeTab,
  onTabChange,
  driveActive
}: Pick<AppShellProps, 'activeTab' | 'onTabChange' | 'driveActive'>) {
  return (
    <div className="bc-shell-nav-items">
      {TABS.map(({ id, label, icon: Icon }) => {
        const selected = id === activeTab;
        return (
          <button
            key={id}
            type="button"
            className={classNames('bc-shell-nav-item', selected && 'is-selected')}
            aria-current={selected ? 'page' : undefined}
            onClick={() => onTabChange(id)}
          >
            <span className="bc-shell-nav-item__icon">
              <Icon aria-hidden="true" size={23} />
              {id === 'home' && driveActive ? <span className="bc-drive-active-dot" aria-label="Drive active" /> : null}
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
