// TurfPro — Plans screen
// Recurring is the default. Plans is the primary tab.

function ScreenPlans() {
  const plans = [
    {
      cust: 'Marisol Carrington',
      addr: '411 Lantana Ave',
      services: ['Mow', 'Edge'],
      fee: 55,
      cycle: 'weekly',
      day: 'Wed',
      status: 'active',
      next: 'Today',
      since: 'Mar 2024',
      seasonal: false,
    },
    {
      cust: 'Reza Vargas',
      addr: '57 Spruce Hollow',
      services: ['Mow', 'Trim', '5-step fert'],
      fee: 95,
      cycle: 'weekly',
      day: 'Wed',
      status: 'active',
      next: 'Today · step 2 due',
      since: 'May 2023',
      seasonal: false,
      flag: 'fert',
    },
    {
      cust: 'Wei Lin',
      addr: '309 Birchwood Dr',
      services: ['Mow'],
      fee: 50,
      cycle: 'biweekly',
      day: 'Wed',
      status: 'active',
      next: 'Today',
      since: 'Apr 2025',
      seasonal: false,
    },
    {
      cust: 'Joseph Holland',
      addr: '14 Foxglove Ct',
      services: ['Mow', 'Blow'],
      fee: 45,
      cycle: 'weekly',
      day: 'Wed',
      status: 'paused',
      next: 'Resumes Jun 4',
      since: 'Aug 2022',
      seasonal: false,
    },
    {
      cust: 'Aysel Demir',
      addr: '202 Tulipwood Way',
      services: ['Mow', 'Trim', 'Snow rem.'],
      fee: 60,
      cycle: 'weekly',
      day: 'Wed',
      status: 'active',
      next: 'Today',
      since: 'Oct 2024',
      seasonal: true,
    },
  ];

  return (
    <ScreenShell scrollable={true}>
      <div style={{ padding: '4px 22px 14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: TP.ink500, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase' }}>67 active · $14,820 MRR</div>
          <div className="tp-display" style={{ fontSize: 28, fontWeight: 700 }}>Plans</div>
        </div>
        <div style={{ width: 38, height: 38, borderRadius: 19, background: TP.green800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" color="#fff" size={18}/>
        </div>
      </div>

      {/* search */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
          background: TP.card, borderRadius: 14, border: '1px solid ' + TP.ink100,
        }}>
          <Icon name="search" size={16} color={TP.ink400}/>
          <div style={{ fontSize: 14, color: TP.ink400, flex: 1 }}>Search customers, services…</div>
        </div>
      </div>

      {/* filter chips */}
      <div style={{ padding: '0 16px 14px', display: 'flex', gap: 6, overflowX: 'auto' }}>
        {[
          { label: 'All',           count: 67, on: true },
          { label: 'Weekly',        count: 52 },
          { label: 'Biweekly',      count: 11 },
          { label: 'Monthly',       count: 4 },
          { label: 'Paused',        count: 3 },
          { label: 'Snow swap',     count: 8 },
        ].map((c, i) => (
          <div key={i} style={{
            padding: '7px 13px', borderRadius: 99, whiteSpace: 'nowrap',
            background: c.on ? TP.green800 : TP.card,
            border: '1px solid ' + (c.on ? TP.green800 : TP.ink200),
            color: c.on ? '#fff' : TP.ink700,
            fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            {c.label}
            <span style={{ color: c.on ? TP.bronze400 : TP.ink400, fontVariantNumeric: 'tabular-nums' }}>{c.count}</span>
          </div>
        ))}
      </div>

      {/* Plan cards */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {plans.map((p, i) => (
          <div key={i} style={{
            background: TP.card, borderRadius: 16, padding: '14px 14px 12px',
            border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)',
            position: 'relative', overflow: 'hidden',
          }}>
            {/* left accent strip */}
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
              background: p.status === 'paused' ? TP.ink300 : TP.green600,
            }}/>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              {/* avatar */}
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: p.status === 'paused' ? TP.ink100 : TP.green100,
                color: p.status === 'paused' ? TP.ink500 : TP.green800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 14, letterSpacing: -0.2,
              }}>
                {p.cust.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </div>

              {/* main */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: TP.ink900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.cust}
                  </div>
                  <div className="tp-num" style={{ fontSize: 15, fontWeight: 700, color: TP.ink900 }}>
                    ${p.fee}<span style={{ fontSize: 11, color: TP.ink500, fontWeight: 500 }}>/{p.cycle === 'weekly' ? 'wk' : p.cycle === 'biweekly' ? '2wk' : 'mo'}</span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: TP.ink500, marginTop: 1 }}>{p.addr}</div>

                {/* services */}
                <div style={{ display: 'flex', gap: 5, marginTop: 9, flexWrap: 'wrap' }}>
                  {p.services.map((s, j) => (
                    <div key={j} style={{
                      padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                      background: TP.green50, color: TP.green700, border: '1px solid ' + TP.green100,
                    }}>{s}</div>
                  ))}
                  {p.seasonal && (
                    <div style={{ padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: TP.bronze100, color: TP.bronze700 }}>
                      ❄ Snow swap
                    </div>
                  )}
                </div>

                {/* footer row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 11, paddingTop: 10, borderTop: '1px dashed ' + TP.ink100 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: TP.ink700, fontWeight: 600 }}>
                      <Icon name="plans" size={11} color={TP.ink500}/> {p.cycle === 'weekly' ? `Every ${p.day}` : p.cycle === 'biweekly' ? `Biweekly · ${p.day}` : 'Monthly'}
                    </span>
                    <span style={{ color: TP.ink300 }}>·</span>
                    <span style={{ color: p.status === 'paused' ? TP.ink500 : TP.green700, fontWeight: 600 }}>
                      {p.next}
                    </span>
                  </div>
                  <Icon name="chevron-right" size={14} color={TP.ink400}/>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <TabBar active="plans"/>
    </ScreenShell>
  );
}

Object.assign(window, { ScreenPlans });
