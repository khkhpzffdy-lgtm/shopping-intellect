/* Shopping Intellect v2 — primitives, icons, shared UI */

const BGN_RATE = 1.95583;
const bgn = (e) => (Math.round(e * BGN_RATE * 100) / 100).toFixed(2).replace('.', ',');
const eurStr = (e) => '€' + e.toFixed(2);

const Ic = {
  menu:   <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  search: <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  kebab:  <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="19" r="1.7" fill="currentColor"/></svg>,
  chevD:  <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chevR:  <svg viewBox="0 0 8 14" fill="none"><path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  back:   <svg viewBox="0 0 24 24" fill="none"><path d="M19 12H5M5 12l6-6M5 12l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  plus:   <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>,
  mic:    <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8"/><path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  x:      <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  xs:     <svg viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  trash:  <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  heartF: <svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.7-10-9.3C.5 8.4 2 4.8 5.4 4.8c2 0 3.3 1.1 4.1 2.3l.5.8.5-.8c.8-1.2 2.1-2.3 4.1-2.3 3.4 0 4.9 3.6 3.4 6.9C19.5 16.3 12 21 12 21z" fill="var(--accent)"/></svg>,
  heartE: <svg viewBox="0 0 24 24"><path d="M12 20s-6.8-4.3-9.1-8.5C1.5 8.6 2.8 5.8 5.6 5.8c1.8 0 3 1 3.8 2.1l.6.9.6-.9c.8-1.1 2-2.1 3.8-2.1 2.8 0 4.1 2.8 2.7 5.7C18.8 15.7 12 20 12 20z" fill="none" stroke="var(--ink-3)" strokeWidth="1.7"/></svg>,
  check:  <svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  anchor: <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="5" r="2.3" stroke="currentColor" strokeWidth="1.8"/><path d="M12 7.3V21M5 12a7 7 0 0014 0M5 12H3m16 0h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  bag:    <svg viewBox="0 0 24 24" fill="none"><path d="M6 8h12l-1 12a1 1 0 01-1 1H8a1 1 0 01-1-1L6 8z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"/><path d="M9 8V6a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></svg>,
  scales: <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 006 0L5 7zm14 0l-3 6a3 3 0 006 0l-3-6zM12 4.5L5 7m7-2.5L19 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  list:   <svg viewBox="0 0 24 24" fill="none"><path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/></svg>,
  family: <svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8"/><circle cx="17" cy="9" r="2.3" stroke="currentColor" strokeWidth="1.8"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M15.5 13.5c2.6.2 4.5 2 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  user:   <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  cart:   <svg viewBox="0 0 24 24" fill="none"><path d="M4 5h2l2 11h9l2-8H7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><circle cx="9" cy="20" r="1.4" fill="currentColor"/><circle cx="17" cy="20" r="1.4" fill="currentColor"/></svg>,
  clip:   <svg viewBox="0 0 24 24" fill="none"><rect x="5" y="4" width="14" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.7"/><path d="M9 4.5A1.5 1.5 0 0110.5 3h3A1.5 1.5 0 0115 4.5V5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-.5z" fill="currentColor"/></svg>,
  wifiOff:<svg viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M9.5 16.5a3.5 3.5 0 014.9 0M5.5 12.8a9 9 0 0110-1.8M2 9a15 15 0 016-3.3m5 .3A15 15 0 0122 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>,
  notes:  <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  sun:    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>,
  moon:   <svg viewBox="0 0 24 24" fill="none"><path d="M20 14a8 8 0 01-10-10 8 8 0 1010 10z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>,
};

function Money({ eur, promo }) {
  return (
    <div className={'money' + (promo ? ' money--promo' : '')}>
      <span className="money__eur">{eurStr(eur)}</span>
      <span className="money__bgn">{bgn(eur)} лв</span>
    </div>
  );
}

function BrandChip({ label, big }) {
  return (
    <span className="brandchip" style={big ? { height: 24, fontSize: 12 } : null} title="Закотвена марка — докосни за всички">
      {label}<span className="brandchip__x">{Ic.xs}</span>
    </span>
  );
}

function TabBar({ active }) {
  const tabs = [
    { k: 'list', t: 'Списъци', i: Ic.list },
    { k: 'family', t: 'Семейство', i: Ic.family },
    { k: 'profile', t: 'Профил', i: Ic.user },
  ];
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <button className={'tab' + (active === t.k ? ' tab--on' : '')} key={t.k}>
          {t.i}<span>{t.t}</span>
        </button>
      ))}
    </div>
  );
}

Object.assign(window, { Ic, Money, BrandChip, TabBar, bgn, eurStr });
