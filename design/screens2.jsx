/* Shopping Intellect v2 — screens (Bulgarian copy, EUR prices) */

const LIST_ITEMS = [
  { k: 'banana', e: '🍌', term: 'Банани', qty: '1 кг', fav: true, by: 'М' },
  { k: 'tomato', e: '🍅', term: 'Домати', qty: '500 г', by: 'Г' },
  { k: 'cuke', e: '🥒', term: 'Краставици', qty: '2 бр.', by: 'М' },
  { k: 'yog', e: '🥛', term: 'Кисело мляко', qty: '4 бр.', anchor: 'Верея', fav: true, by: 'М' },
  { k: 'bread', e: '🍞', term: 'Хляб', qty: '1 бр.', by: 'Г' },
  { k: 'eggs', e: '🥚', term: 'Яйца', qty: '10 бр.', by: 'И' },
  { k: 'cheese', e: '🧀', term: 'Сирене', qty: '200 г', by: 'М' },
  { k: 'chick', e: '🫘', term: 'Нахут', qty: '1 консерва', matching: true, by: 'Г' },
];
const AV_HUE = { 'М': '#6D4AE6', 'Г': '#2E8B8B', 'И': '#E0A21A' };

const FILTERS = ['Всички', 'Плодове', 'Зеленчуци', 'Млечни', 'Месо', 'Хляб'];

/* ============================================================
   SCREEN 1 — List (planning + shopping via mode toggle)
   ============================================================ */
function ListScreen({ initialMode = 'plan' }) {
  const [mode, setMode] = React.useState(initialMode);
  const [fav, setFav] = React.useState(() => Object.fromEntries(LIST_ITEMS.map((i) => [i.k, !!i.fav])));
  const [done, setDone] = React.useState({ banana: true, tomato: true, bread: true });
  const [filter, setFilter] = React.useState('Всички');
  const shopping = mode === 'shop';
  const doneCount = LIST_ITEMS.filter((i) => done[i.k]).length;
  const pct = Math.round((doneCount / LIST_ITEMS.length) * 100);

  return (
    <div className="app">
      <div className="appbar">
        <button className="iconbtn">{Ic.menu}</button>
        <div className="appbar__title">Shopping <b>Intellect</b></div>
        <button className="iconbtn">{Ic.search}</button>
        <button className="iconbtn">{Ic.kebab}</button>
      </div>

      <div className="listhead">
        <button className="switcher">Седмичен списък {Ic.chevD}</button>
        <span className="listhead__spacer"></span>
        <span className="badge">{Ic.family}Иванови</span>
      </div>
      <div className="subline">
        <span className="sync__dot"></span>обновено преди 4 мин · 8 продукта
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 16px 4px' }}>
        <div className="modeseg">
          <button className="modeseg__opt" data-on={!shopping} onClick={() => setMode('plan')}>{Ic.clip}Планиране</button>
          <button className="modeseg__opt" data-on={shopping} onClick={() => setMode('shop')}>{Ic.cart}Пазаруване</button>
        </div>
      </div>

      {!shopping && (
        <div className="addbar">
          <button className="addbar__plus">{Ic.plus}</button>
          <span className="addbar__input">Добави продукт…</span>
          <span className="addbar__mic">{Ic.mic}</span>
        </div>
      )}

      {!shopping && (
        <div className="chips">
          {FILTERS.map((f) => (
            <button className={'chip' + (filter === f ? ' chip--on' : '')} key={f} onClick={() => setFilter(f)}>
              {f === 'Всички' && Ic.list}{f}
            </button>
          ))}
        </div>
      )}

      {shopping && <div className="offline-banner">{Ic.wifiOff}Офлайн · отметките се запазват и ще се синхронизират</div>}
      {shopping && (
        <div className="progress">
          <div className="progress__row">
            <span className="progress__count"><b>{doneCount}</b> / {LIST_ITEMS.length} в кошницата</span>
            <span className="progress__label">{pct}%</span>
          </div>
          <div className="progress__track"><div className="progress__fill" style={{ width: pct + '%' }}></div></div>
        </div>
      )}

      <div className="app__scroll">
        <div className="glist">
          {LIST_ITEMS.map((it) => (
            <div
              className={'git' + (shopping ? ' git--shop' : '') + (shopping && done[it.k] ? ' git--done' : '')}
              key={it.k}
              onClick={() => shopping && setDone((d) => ({ ...d, [it.k]: !d[it.k] }))}
            >
              {shopping && <span className="checkbox">{Ic.check}</span>}
              <span className="git__emoji">{it.e}</span>
              <div className="git__main">
                <div className="git__name">
                  {it.term}
                  {it.anchor && <BrandChip label={it.anchor} />}
                </div>
                <div className="git__sub">
                  {it.matching && !shopping
                    ? <span className="matching"><span className="matching__pulse"></span>съпоставяне на цени…</span>
                    : shopping
                      ? <span className="attr"><span className="attr__av" style={{ background: AV_HUE[it.by] }}>{it.by}</span>{it.by === 'М' ? 'Мария' : it.by === 'Г' ? 'Георги' : 'Ива'}</span>
                      : <span className="git__qty">{it.qty}</span>}
                </div>
              </div>
              {!shopping && (
                <button className="git__fav" onClick={(ev) => { ev.stopPropagation(); setFav((f) => ({ ...f, [it.k]: !f[it.k] })); }}>
                  {fav[it.k] ? Ic.heartF : Ic.heartE}
                </button>
              )}
              {shopping
                ? <span className="git__qty">{it.qty}</span>
                : <><span className="git__chev">{Ic.chevR}</span></>}
            </div>
          ))}
          <div style={{ height: 130 }}></div>
        </div>
      </div>

      {!shopping && <button className="fab">{Ic.scales}</button>}
      <TabBar active="list" />
    </div>
  );
}

/* ============================================================
   SCREEN 2 — Add / Search
   ============================================================ */
const CATS = [
  { e: '🍎', t: 'Плодове' }, { e: '🥦', t: 'Зеленчуци' }, { e: '🥛', t: 'Млечни' },
  { e: '🥩', t: 'Месо и риба' }, { e: '🍞', t: 'Хляб и тестени' }, { e: '🥤', t: 'Напитки' },
  { e: '❄️', t: 'Замразени' }, { e: '🍫', t: 'Сладки и снакс' }, { e: '🥫', t: 'Консерви и сухи' },
  { e: '🧴', t: 'Почистване и дом' }, { e: '💄', t: 'Козметика и грижа' }, { e: '🍼', t: 'Бебе и деца' },
  { e: '🐾', t: 'Любимци' }, { e: '🛒', t: 'Други' },
];
const FAVS = [
  { e: '🥛', t: 'Кисело мляко' }, { e: '🍞', t: 'Хляб' }, { e: '🍌', t: 'Банани' }, { e: '☕', t: 'Кафе' },
];
const FREQ = [
  { e: '🥚', t: 'Яйца', m: '×7' }, { e: '🧀', t: 'Сирене', m: '×6' }, { e: '🍅', t: 'Домати', m: '×5' },
];

function AddScreen() {
  const [filled, setFilled] = React.useState({});
  return (
    <div className="app">
      <div className="appbar appbar--sheet">
        <div className="appbar__h">Добави продукт</div>
        <button className="iconbtn">{Ic.x}</button>
      </div>

      <div className="searchbar">
        {Ic.search}
        <span className="searchbar__input">Напиши продукт…</span>
        {Ic.mic}
      </div>

      <div className="app__scroll">
        <div className="sectlabel--sm sectlabel">❤ Любими</div>
        <div className="quickrow">
          {FAVS.map((f) => (
            <button className="qchip" key={f.t} onClick={() => setFilled((s) => ({ ...s, [f.t]: true }))}>
              <span className="qchip__e">{f.e}</span><span className="qchip__t">{f.t}</span>
              <span style={{ color: 'var(--accent)', display: 'flex' }}>{filled[f.t] ? Ic.check : Ic.plus}</span>
            </button>
          ))}
        </div>

        <div className="sectlabel--sm sectlabel">Често купувани</div>
        <div className="quickrow">
          {FREQ.map((f) => (
            <button className="qchip" key={f.t} onClick={() => setFilled((s) => ({ ...s, [f.t]: true }))}>
              <span className="qchip__e">{f.e}</span><span className="qchip__t">{f.t}</span>
              <span className="qchip__m">{f.m}</span>
            </button>
          ))}
        </div>

        <div className="sectlabel">Или избери категория</div>
        <div className="catgrid">
          {CATS.map((c) => (
            <button className="cat" key={c.t}>
              <span className="cat__e">{c.e}</span>
              <span className="cat__t">{c.t}</span>
            </button>
          ))}
        </div>
        <div style={{ height: 20 }}></div>
      </div>
    </div>
  );
}

/* ============================================================
   SCREEN 3 — Product Detail (emoji hero + candidates / anchor)
   ============================================================ */
const CANDS = [
  { k: 'fant', store: 'FANTASTICO', name: 'Верея · кисело мляко 2% · 400 г', eur: 1.09, brand: 'Верея' },
  { k: 'lidl1', store: 'LIDL', name: 'Pilos · кисело мляко 3,6% · 400 г', eur: 0.85, promo: true, brand: 'Pilos' },
  { k: 'kauf1', store: 'KAUFLAND', name: 'Olympus · кисело мляко 2% · 400 г', eur: 1.39, brand: 'Olympus' },
  { k: 'billa', store: 'BILLA', name: 'Верея · кисело мляко 3,6% · 400 г', eur: 1.25, brand: 'Верея' },
  { k: 'kauf2', store: 'KAUFLAND', name: 'Боженци · кисело мляко · 400 г', eur: 1.49, promo: true, brand: 'Боженци' },
  { k: 'lidl2', store: 'LIDL', name: 'кисело мляко 3,6% · 400 г', eur: 0.79, brand: null },
];

function DetailScreen() {
  const [fav, setFav] = React.useState(true);
  const [anchored, setAnchored] = React.useState('fant');
  const [qty, setQty] = React.useState(4);
  return (
    <div className="app">
      <div className="appbar appbar--sheet">
        <button className="iconbtn">{Ic.back}</button>
        <div className="appbar__center">Продукт</div>
        <button className="iconbtn iconbtn--danger">{Ic.trash}</button>
      </div>

      <div className="app__scroll">
        <div className="hero">
          <span className="hero__emoji">🥛</span>
          <div className="hero__title">
            Кисело мляко
            <button className="hero__fav" onClick={() => setFav(!fav)}>{fav ? Ic.heartF : Ic.heartE}</button>
          </div>
          <div className="hero__row">
            <button className="catchip">Млечни {Ic.chevD}</button>
          </div>
        </div>

        <div className="notes-row">{Ic.notes}Бележки</div>

        <div className="group">
          <div className="group__head"><span className="group__title">Количество</span></div>
          <div className="qtygrid">
            <div className="qtygrid__cell">
              <div className="qtygrid__label">Брой</div>
              <div className="stepper">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <span className="stepper__v">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)}>+</button>
              </div>
            </div>
            <div className="qtygrid__cell">
              <div className="qtygrid__label">Мярка</div>
              <div className="qtygrid__val"><span style={{ fontSize: 17 }}>бр.</span> {Ic.chevD}</div>
            </div>
          </div>
        </div>

        <div className="statebar">
          <span className="seclabel">BROAD</span>
          Всички марки · 12 оферти в 4 магазина
        </div>

        {CANDS.map((c) => {
          const on = anchored === c.k;
          return (
            <div className={'candidate' + (on ? ' candidate--anchored' : '')} key={c.k}>
              <div className="candidate__main">
                <div className="candidate__store">
                  <span className="store">{c.store}</span>
                  {c.promo && <span className="promo">Промо</span>}
                  {on && <BrandChip label={c.brand} big />}
                </div>
                <div className="candidate__name">{c.name}</div>
              </div>
              <div className="candidate__right">
                <Money eur={c.eur} promo={c.promo} />
                {c.brand
                  ? <button className={'anchor-btn' + (on ? ' anchor-btn--on' : '')} onClick={() => setAnchored(on ? null : c.k)}>
                      {Ic.anchor}{on ? 'Закотвена' : 'Закотви'}
                    </button>
                  : <span className="anchor-hint">няма марка</span>}
              </div>
            </div>
          );
        })}

        <div style={{ height: 16 }}></div>
      </div>
      <div className="detaildock">
        <button className="dockbtn">{Ic.scales}Сравни цените</button>
      </div>
    </div>
  );
}

Object.assign(window, { ListScreen, AddScreen, DetailScreen });
