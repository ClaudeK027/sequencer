import { Icon, type IconName } from './Icon';

export type MobileTab = 'library' | 'editor' | 'timer';

interface Props {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

const TABS: Array<{ id: MobileTab; label: string; icon: IconName }> = [
  { id: 'library', label: 'Séquences', icon: 'folder' },
  { id: 'editor', label: 'Éditeur', icon: 'list' },
  { id: 'timer', label: 'Minuteur', icon: 'clock' },
];

export function MobileNav({ active, onChange }: Props): JSX.Element {
  return (
    <nav className="mobile-nav" aria-label="Navigation principale">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`mobile-tab-btn ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? 'page' : undefined}
        >
          <Icon name={tab.icon} size={20} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
