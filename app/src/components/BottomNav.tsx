type Tab = 'lists' | 'add';

type BottomNavProps = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
};

export const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => (
  <nav className="bottomnav" aria-label="Main navigation">
    <button
      type="button"
      className={`bottomnav__tab${activeTab === 'lists' ? ' bottomnav__tab--active' : ''}`}
      onClick={() => onTabChange('lists')}
      aria-current={activeTab === 'lists' ? 'page' : undefined}
    >
      <span className="bottomnav__icon" aria-hidden="true">☰</span>
      <span className="bottomnav__label">Списъци</span>
    </button>
    <button
      type="button"
      className={`bottomnav__tab${activeTab === 'add' ? ' bottomnav__tab--active' : ''}`}
      onClick={() => onTabChange('add')}
      aria-current={activeTab === 'add' ? 'page' : undefined}
    >
      <span className="bottomnav__icon" aria-hidden="true">+</span>
      <span className="bottomnav__label">Добавяне</span>
    </button>
  </nav>
);
