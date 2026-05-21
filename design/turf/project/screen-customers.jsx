// TurfPro — Customers list
// Parity with PressurePro pages, but MRR contribution becomes the right-rail number.

function ScreenCustomers() {
  const sections = [
    {
      letter: 'B',
      rows: [
        { name: 'Mason Briggs',        addr: '21 Heron Ln',         props: 1, mrr: 280, since: '22', tags: ['gate'] },
      ],
    },
    {
      letter: 'C',
      rows: [
        { name: 'Marisol Carrington',  addr: '411 Lantana Ave',     props: 1, mrr: 220, since: '24', tags: ['pet-safe'] },
      ],
    },
    {
      letter: 'D',
      rows: [
        { name: 'Aysel Demir',         addr: '202 Tulipwood Way',   props: 2, mrr: 360, since: '24', tags: ['snow'] },
      ],
    },
    {
      letter: 'H',
      rows: [
        { name: 'Joseph Holland',      addr: '14 Foxglove Ct',      props: 1, mrr:   0, since: '22', tags: ['paused'] },
        { name: 'Priya Hartwell',      addr: '88 Magnolia Rd',      props: 3, mrr: 540, since: '21', tags: ['vip'] },
      ],
    },
    {
      letter: 'L',
      rows: [
        { name: 'Wei Lin',             addr: '309 Birchwood Dr',    props: 1, mrr: 100, since: '25', tags: [] },
      ],
    },
    {
      letter: 'O',
      rows: [
        { name: 'Chinedu Okafor',      addr: '142 Cedar Crest',     props: 1, mrr: 180, since: '23', tags: ['dog'] },
      ],
    },
    {
      letter: 'V',
      rows: [
        { name: 'Reza Vargas',         addr: '57 Spruce Hollow',    props: 1, mrr: 380, since: '23', tags: ['fert'] },
      ],
    },
  ];

  const tagStyle = (t) => {
    const map = {
      gate:     { bg: TP.ink100,    fg: TP.ink700,            label: '🔒 Gate' },
      'pet-safe':{bg: TP.green100,  fg: TP.green700,          label: '🌱 Pet-safe' },
      dog:      { bg: TP.ink100,    fg: TP.ink700,            label: '🐕 Dog' },
      vip:      { bg: TP.bronze100, fg: TP.bronze700,         label: '★ VIP' },
      fert:     { bg: TP.green100,  fg: TP.green700,          label: 'Fert' },
      snow:     { bg: 'hsl(212 50% 94%)', fg: 'hsl(212 60% 35%)', label: '❄ Snow' },
      paused:   { bg: TP.ink100,    fg: TP.ink500,            label: 'Paused' },
    };
    return map[t] || { bg: TP.ink100, fg: TP.ink700, label: t };
  };

  return (
    <ScreenShell scrollable={true}>
      <div style={{ padding: '4px 22px 12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: TP.ink500, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase' }}>87 total · 9 properties</div>
          <div className="tp-display" style={{ fontSize: 28, fontWeight: 700 }}>Customers</div>
        </div>
        <div style={{ width: 38, height: 38, borderRadius: 19, background: TP.green800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" color="#fff" size={18}/>
        </div>
      </div>

      {/* search */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
          background: TP.card, borderRadius: 14, border: '1px solid ' + TP.ink100,
        }}>
          <Icon name="search" size={16} color={TP.ink400}/>
          <div style={{ fontSize: 14, color: TP.ink400, flex: 1 }}>Search by name, address…</div>
        </div>
      </div>

      {/* sort + filter row */}
      <div style={{ padding: '0 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ padding: '6px 11px', borderRadius: 99, background: TP.ink100, fontSize: 11.5, fontWeight: 600, color: TP.ink700 }}>A–Z</div>
          <div style={{ padding: '6px 11px', borderRadius: 99, background: 'transparent', border: '1px solid ' + TP.ink200, fontSize: 11.5, fontWeight: 600, color: TP.ink500 }}>By MRR</div>
          <div style={{ padding: '6px 11px', borderRadius: 99, background: 'transparent', border: '1px solid ' + TP.ink200, fontSize: 11.5, fontWeight: 600, color: TP.ink500 }}>Recent</div>
        </div>
        <div style={{ fontSize: 11.5, color: TP.ink500, fontWeight: 500 }}>Filter</div>
      </div>

      {/* Sections */}
      {sections.map((sec, si) => (
        <div key={si}>
          <div style={{ padding: '12px 22px 6px', fontSize: 11, fontWeight: 700, color: TP.ink500, letterSpacing: 1.2 }}>
            {sec.letter}
          </div>
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sec.rows.map((r, ri) => {
              const initials = r.name.split(' ').map(w => w[0]).slice(0, 2).join('');
              const isPaused = r.tags.includes('paused');
              return (
                <div key={ri} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: TP.card, borderRadius: 14, padding: '12px 14px',
                  border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 20,
                    background: isPaused ? TP.ink100 : TP.green800,
                    color: isPaused ? TP.ink500 : TP.bronze400,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 13,
                  }}>{initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: TP.ink900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div className="tp-num" style={{ fontSize: 13.5, fontWeight: 700, color: r.mrr ? TP.ink900 : TP.ink400 }}>
                        {r.mrr ? `$${r.mrr}` : '—'}<span style={{ fontSize: 10, color: TP.ink500, fontWeight: 500 }}>{r.mrr ? '/mo' : ''}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <div style={{ fontSize: 12, color: TP.ink500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {r.addr}{r.props > 1 ? ` · ${r.props} props` : ''}
                      </div>
                      <div style={{ fontSize: 10, color: TP.ink400, fontWeight: 500 }}>since '{r.since}</div>
                    </div>
                    {r.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 7 }}>
                        {r.tags.map((t, ti) => {
                          const st = tagStyle(t);
                          return (
                            <div key={ti} style={{ padding: '2px 7px', borderRadius: 99, background: st.bg, color: st.fg, fontSize: 10.5, fontWeight: 600 }}>{st.label}</div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* alphabet rail decoration */}
      <div style={{
        position: 'absolute', right: 4, top: 200, bottom: 100,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        fontSize: 9, fontWeight: 700, color: TP.ink400, letterSpacing: 0.6, lineHeight: 1,
        pointerEvents: 'none',
      }}>
        {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => (
          <div key={l} style={{ opacity: 'BCDHLOV'.includes(l) ? 1 : 0.4, color: 'BCDHLOV'.includes(l) ? TP.green700 : TP.ink400 }}>{l}</div>
        ))}
      </div>

      <TabBar active="people"/>
    </ScreenShell>
  );
}

Object.assign(window, { ScreenCustomers });
