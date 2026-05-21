// TurfPro — Routes screen
// Week strip + ordered stop list with drag-to-reorder + skip-this-week + drive times.

function ScreenRoutes() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dates = [18, 19, 20, 21, 22, 23, 24];
  const counts = [9, 12, 11, 4, 7, 0, 0];
  const sel = 2; // Wednesday

  const stops = [
    { n: 1, status: 'done',   addr: '88 Magnolia Rd',     cust: 'Patel · S.',   svc: ['Mow', 'Edge'],         fee: 55, drive: '0 min', tags: [] },
    { n: 2, status: 'done',   addr: '142 Cedar Crest',    cust: 'Okafor · C.',  svc: ['Mow'],                 fee: 45, drive: '4 min · 1.2 mi', tags: ['dog'] },
    { n: 3, status: 'done',   addr: '21 Heron Ln',        cust: 'Briggs · M.',  svc: ['Mow', 'Trim', 'Blow'], fee: 65, drive: '6 min · 2.0 mi', tags: ['gate'] },
    { n: 4, status: 'active', addr: '411 Lantana Ave',    cust: 'Carrington',   svc: ['Mow', 'Edge'],         fee: 55, drive: '7 min · 1.8 mi', tags: ['pet-safe'] },
    { n: 5, status: 'pending',addr: '57 Spruce Hollow',   cust: 'Vargas · R.',  svc: ['Mow', 'Fert step 2'],  fee: 95, drive: '5 min · 1.4 mi', tags: ['fert'] },
    { n: 6, status: 'pending',addr: '309 Birchwood Dr',   cust: 'Lin · W.',     svc: ['Biweekly mow'],        fee: 50, drive: '8 min · 2.3 mi', tags: [] },
    { n: 7, status: 'skipped',addr: '14 Foxglove Ct',     cust: 'Holland · J.', svc: ['Mow'],                 fee: 45, drive: '3 min · 0.9 mi', tags: ['skip'] },
    { n: 8, status: 'pending',addr: '202 Tulipwood Way',  cust: 'Demir · A.',   svc: ['Mow', 'Trim'],         fee: 60, drive: '11 min · 3.4 mi', tags: [] },
    { n: 9, status: 'pending',addr: '6 Cottonmill Rd',    cust: 'Ramirez · L.', svc: ['Mow'],                 fee: 45, drive: '5 min · 1.6 mi', tags: [] },
  ];

  const statusStyles = {
    done:    { dotBg: TP.green600,  dotFg: '#fff',         label: 'Done',      pillBg: TP.green100,  pillFg: TP.green700, faded: true },
    active:  { dotBg: TP.bronze500, dotFg: '#fff',         label: 'In progress', pillBg: TP.bronze100, pillFg: 'hsl(28 70% 30%)' },
    pending: { dotBg: '#fff',       dotFg: TP.ink500,      label: 'Pending',   pillBg: 'transparent',pillFg: TP.ink500 },
    skipped: { dotBg: TP.ink100,    dotFg: TP.ink400,      label: 'Skipped',   pillBg: TP.ink100,    pillFg: TP.ink500 },
  };

  return (
    <ScreenShell scrollable={true}>
      <div style={{ padding: '4px 22px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: TP.ink500, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase' }}>Week of May 18</div>
          <div className="tp-display" style={{ fontSize: 28, fontWeight: 700 }}>Routes</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: 18, border: '1px solid ' + TP.ink200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="search" color={TP.ink700} size={16}/>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: 18, background: TP.green800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" color="#fff" size={16}/>
          </div>
        </div>
      </div>

      {/* Week strip */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ background: TP.card, borderRadius: 16, border: '1px solid ' + TP.ink100, padding: 6, display: 'flex', gap: 4, boxShadow: 'var(--shadow-card)' }}>
          {days.map((d, i) => {
            const on = i === sel;
            const past = i < sel;
            return (
              <div key={i} style={{
                flex: 1, padding: '8px 0 6px', borderRadius: 11,
                background: on ? TP.green800 : 'transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                opacity: past ? 0.55 : 1,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: on ? TP.bronze400 : TP.ink500, letterSpacing: 0.5 }}>{d}</div>
                <div className="tp-num" style={{ fontSize: 17, fontWeight: 700, color: on ? '#fff' : TP.ink900 }}>{dates[i]}</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: on ? '#cfead8' : TP.ink400 }}>{counts[i] || '–'}{counts[i] ? ' stops' : ''}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day summary + start CTA */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div className="tp-display" style={{ fontSize: 18, fontWeight: 700, color: TP.ink900 }}>Wednesday · 11 stops</div>
            <div style={{ fontSize: 12, color: TP.ink500, marginTop: 2 }}>3 done · 1 active · 6 pending · 1 skipped</div>
          </div>
          <button style={{
            padding: '9px 14px', borderRadius: 99, background: TP.bronze500, color: '#fff', border: 'none',
            fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6,
            boxShadow: 'var(--shadow-bronze)',
          }}>
            <Icon name="play" size={11}/> Resume
          </button>
        </div>

        {/* progress + mileage gauges */}
        <div style={{ background: TP.card, borderRadius: 14, padding: '12px 14px', border: '1px solid ' + TP.ink100, display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: TP.ink500, marginBottom: 6 }}>
              <span>4 / 11 complete</span><span className="tp-num">36%</span>
            </div>
            <div style={{ height: 6, background: TP.ink100, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: '36%', height: '100%', background: 'linear-gradient(90deg,' + TP.green600 + ',' + TP.bronze500 + ')' }}/>
            </div>
          </div>
          <div style={{ width: 1, height: 32, background: TP.ink200 }}/>
          <div style={{ textAlign: 'right' }}>
            <div className="tp-num" style={{ fontSize: 15, fontWeight: 700 }}>$310</div>
            <div style={{ fontSize: 10, color: TP.ink500 }}>collected today</div>
          </div>
        </div>
      </div>

      {/* Ordered stop list */}
      <div style={{ padding: '0 16px' }}>
        {stops.map((s, i) => {
          const st = statusStyles[s.status];
          const isActive = s.status === 'active';
          return (
            <React.Fragment key={s.n}>
              {/* drive time connector */}
              {i > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0 4px 22px', color: TP.ink400, fontSize: 10.5 }}>
                  <div style={{ width: 2, height: 8, background: TP.ink200, marginLeft: 11 }}/>
                  <Icon name="truck" size={11} color={TP.ink400}/>
                  <span>{s.drive}</span>
                </div>
              )}

              <div style={{
                background: isActive ? TP.green50 : TP.card,
                borderRadius: 14, padding: '12px 12px',
                border: '1px solid ' + (isActive ? TP.green100 : TP.ink100),
                boxShadow: isActive ? '0 4px 16px -8px hsl(148 65% 25% / 0.4)' : 'var(--shadow-card)',
                display: 'flex', alignItems: 'center', gap: 12,
                opacity: st.faded ? 0.65 : 1,
                position: 'relative',
              }}>
                {/* drag handle */}
                <div style={{ color: TP.ink300, marginLeft: -4 }}>
                  <Icon name="grip" size={16}/>
                </div>

                {/* stop number / status dot */}
                <div style={{
                  width: 30, height: 30, borderRadius: 15, flexShrink: 0,
                  background: st.dotBg, color: st.dotFg,
                  border: s.status === 'pending' ? '1.5px solid ' + TP.ink300 : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                }}>
                  {s.status === 'done' ? <Icon name="check" size={14}/> : s.status === 'skipped' ? <Icon name="skip" size={12}/> : s.n}
                </div>

                {/* main */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: TP.ink900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.addr}</div>
                    <div className="tp-num" style={{ fontSize: 13.5, fontWeight: 700, color: isActive ? TP.bronze600 : TP.ink700 }}>${s.fee}</div>
                  </div>
                  <div style={{ fontSize: 11.5, color: TP.ink500, marginTop: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{s.cust}</span>
                    <span style={{ color: TP.ink300 }}>·</span>
                    <span>{s.svc.join(' + ')}</span>
                  </div>
                  {(s.tags.length > 0 || isActive) && (
                    <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                      {isActive && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 99, background: TP.bronze100, color: 'hsl(28 70% 28%)', fontSize: 10.5, fontWeight: 600 }}>
                          <div style={{ width: 5, height: 5, borderRadius: 3, background: TP.bronze500 }}/> On site · 8 min
                        </div>
                      )}
                      {s.tags.map(t => (
                        <div key={t} style={{ padding: '2px 7px', borderRadius: 99, background: TP.ink100, color: TP.ink700, fontSize: 10.5, fontWeight: 500 }}>
                          {t === 'dog' && '🐕 '}{t === 'gate' && '🔒 '}{t === 'pet-safe' && '🌱 '}{t === 'fert' && 'Fert '}{t === 'skip' && '↷ '}
                          {t === 'pet-safe' ? 'Pet-safe chem only' : t === 'gate' ? 'Gate code 4127' : t === 'fert' ? 'Step 2 due' : t === 'skip' ? 'Customer travelling' : t}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        {/* tail */}
        <div style={{ padding: '14px 0 4px', textAlign: 'center', fontSize: 12, color: TP.ink400 }}>
          + 2 more stops · ends ~3:45pm
        </div>
      </div>

      <TabBar active="route"/>
    </ScreenShell>
  );
}

Object.assign(window, { ScreenRoutes });
