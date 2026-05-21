// TurfPro — Home variant
// Denser, tabular direction. No gradient hero — instead an inline KPI
// row + a compact "next stop" strip. Feels closer to a fleet dashboard.

function ScreenHomeAlt() {
  const stops = [
    { n: 1, addr: '88 Magnolia Rd',  done: true,  fee: 55, time: '8:14a' },
    { n: 2, addr: '142 Cedar Crest', done: true,  fee: 45, time: '8:42a' },
    { n: 3, addr: '21 Heron Ln',     done: true,  fee: 65, time: '9:08a' },
    { n: 4, addr: '411 Lantana Ave', active: true,fee: 55, time: 'now' },
    { n: 5, addr: '57 Spruce Hollow',fee: 95, time: '~10:10a' },
    { n: 6, addr: '309 Birchwood Dr',fee: 50, time: '~10:40a' },
  ];

  return (
    <ScreenShell scrollable={true}>
      {/* compact header */}
      <div style={{ padding: '4px 22px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: TP.green800, color: TP.bronze400, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, letterSpacing: -0.3 }}>TP</div>
          <div>
            <div style={{ fontSize: 10, color: TP.ink500, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Wed · May 20</div>
            <div className="tp-display" style={{ fontSize: 16, fontWeight: 700, color: TP.ink900, lineHeight: 1.1 }}>Falcon Lawn</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, border: '1px solid ' + TP.ink200, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', background: TP.card }}>
            <Icon name="bell" color={TP.ink700} size={15}/>
            <div style={{ position: 'absolute', top: 7, right: 9, width: 5, height: 5, borderRadius: 3, background: TP.bronze500 }}/>
          </div>
        </div>
      </div>

      {/* KPI row — tabular, no hero */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ background: TP.card, borderRadius: 14, padding: '14px 16px', border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: TP.ink500, letterSpacing: 0.8, textTransform: 'uppercase' }}>MRR</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: TP.green700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name="arrow-up" size={9} stroke={2.4}/> 8.4%
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
            <div className="tp-display tp-num" style={{ fontSize: 36, fontWeight: 700, color: TP.ink900, lineHeight: 1, letterSpacing: -0.03 + 'em' }}>$14,820</div>
            {/* inline sparkline */}
            <svg viewBox="0 0 60 24" style={{ flex: 1, height: 24 }}>
              <polyline points="0,20 8,17 14,15 22,13 28,11 34,9 42,7 50,5 60,3" fill="none" stroke={TP.green600} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="60" cy="3" r="1.8" fill={TP.bronze500}/>
            </svg>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 12, borderTop: '1px dashed ' + TP.ink100 }}>
            <div style={{ flex: 1 }}>
              <div className="tp-num" style={{ fontSize: 15, fontWeight: 700 }}>67</div>
              <div style={{ fontSize: 10, color: TP.ink500 }}>plans</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="tp-num" style={{ fontSize: 15, fontWeight: 700 }}>2.1%</div>
              <div style={{ fontSize: 10, color: TP.ink500 }}>churn</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="tp-num" style={{ fontSize: 15, fontWeight: 700 }}>$221</div>
              <div style={{ fontSize: 10, color: TP.ink500 }}>avg</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="tp-num" style={{ fontSize: 15, fontWeight: 700, color: TP.green700 }}>+$540</div>
              <div style={{ fontSize: 10, color: TP.ink500 }}>30d</div>
            </div>
          </div>
        </div>
      </div>

      {/* Today, as a strip */}
      <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div className="tp-display" style={{ fontSize: 18, fontWeight: 700 }}>Today</div>
        <div className="tp-num" style={{ fontSize: 11, color: TP.ink500, fontWeight: 600 }}>11 stops · 23 mi · ~6:15h</div>
      </div>

      {/* Progress strip with mini timeline */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ background: TP.card, borderRadius: 14, padding: '12px 14px 14px', border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)' }}>
          {/* timeline of stops */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <div style={{ height: 2, background: TP.ink100, position: 'absolute', left: 8, right: 8, top: 11 }}/>
            <div style={{ height: 2, background: 'linear-gradient(90deg,' + TP.green600 + ',' + TP.bronze500 + ')', position: 'absolute', left: 8, top: 11, width: '32%' }}/>
            <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
              {stops.map((s, i) => (
                <div key={i} style={{
                  width: 24, height: 24, borderRadius: 12,
                  background: s.done ? TP.green600 : s.active ? TP.bronze500 : TP.card,
                  border: !s.done && !s.active ? '1.5px solid ' + TP.ink300 : 'none',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  boxShadow: s.active ? '0 0 0 4px rgba(232,151,71,0.15)' : 'none',
                }}>
                  {s.done ? <Icon name="check" size={11} stroke={2.5}/> : <span style={{ color: s.active ? '#fff' : TP.ink500 }}>{s.n}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* now/next row */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px 10px 10px', background: TP.green50, borderRadius: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 30 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: TP.green700, letterSpacing: 0.5 }}>NOW</div>
              <div className="tp-num" style={{ fontSize: 16, fontWeight: 700, color: TP.green800 }}>4</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: TP.ink900 }}>411 Lantana Ave</div>
              <div style={{ fontSize: 11, color: TP.ink500 }}>Carrington · Mow + Edge · $55</div>
            </div>
            <button style={{ padding: '8px 14px', borderRadius: 99, background: TP.bronze500, color: '#fff', border: 'none', fontWeight: 700, fontSize: 12, boxShadow: 'var(--shadow-bronze)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="check" size={11} stroke={2.4}/> Done
            </button>
          </div>

          {/* tabular list of remaining */}
          <div style={{ fontSize: 10, fontWeight: 700, color: TP.ink500, letterSpacing: 0.8, padding: '4px 2px 6px' }}>UP NEXT</div>
          {stops.filter(s => !s.done && !s.active).slice(0, 3).map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '8px 2px', borderTop: i > 0 ? '1px dashed ' + TP.ink100 : 'none' }}>
              <div className="tp-num" style={{ width: 24, fontSize: 11, color: TP.ink400, fontWeight: 600 }}>{s.n}</div>
              <div className="tp-num" style={{ width: 56, fontSize: 11, color: TP.ink500, fontWeight: 500 }}>{s.time}</div>
              <div style={{ flex: 1, fontSize: 13, color: TP.ink900, fontWeight: 500 }}>{s.addr}</div>
              <div className="tp-num" style={{ fontSize: 12, color: TP.ink700, fontWeight: 700 }}>${s.fee}</div>
            </div>
          ))}
        </div>
      </div>

      {/* weather row — compact, no big cards */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '10px 12px', background: TP.card, borderRadius: 12, border: '1px solid ' + TP.ink100 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: TP.ink700, fontWeight: 600 }}>
            <Icon name="sun" size={14} color={TP.drought}/>
            <span className="tp-num">71° · clear</span>
          </div>
          <div style={{ width: 1, height: 12, background: TP.ink200 }}/>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: TP.rain, fontWeight: 600 }}>
            <Icon name="cloud-rain" size={12}/>
            <span>Thu rain · skip 4</span>
          </div>
          <div style={{ width: 1, height: 12, background: TP.ink200 }}/>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'hsl(36 80% 35%)', fontWeight: 600 }}>
            <Icon name="sun" size={12}/>
            <span>Fri → biweekly</span>
          </div>
        </div>
      </div>

      {/* dense quick row */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ background: TP.card, borderRadius: 12, border: '1px solid ' + TP.ink100, padding: 6, display: 'flex' }}>
          {[
            { ic: 'camera', lbl: 'Photo' },
            { ic: 'calc',   lbl: 'Apply' },
            { ic: 'note',   lbl: 'Log' },
            { ic: 'dollar', lbl: 'Quote' },
          ].map((t, i) => (
            <div key={i} style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, borderRight: i < 3 ? '1px solid ' + TP.ink100 : 'none' }}>
              <Icon name={t.ic} size={16} color={TP.ink700}/>
              <div style={{ fontSize: 10.5, color: TP.ink700, fontWeight: 600 }}>{t.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      <TabBar active="home"/>
    </ScreenShell>
  );
}

Object.assign(window, { ScreenHomeAlt });
