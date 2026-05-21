// TurfPro — Reports
// Top KPI is MRR, then weekly route revenue, then churn rate, then per-mile drive-time.

function ScreenReports() {
  // 12-month MRR sparkline
  const mrr = [8100, 8900, 9600, 10400, 11200, 11900, 12500, 13100, 13600, 14100, 14500, 14820];
  const max = Math.max(...mrr);
  const min = Math.min(...mrr) * 0.9;
  const pts = mrr.map((v, i) => {
    const x = (i / (mrr.length - 1)) * 100;
    const y = 100 - ((v - min) / (max - min)) * 100;
    return [x, y];
  });
  const linePath = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
  const areaPath = linePath + ' L100 100 L0 100 Z';

  // Weekly bars — 12 weeks of route revenue
  const wks = [2100, 2380, 2240, 2480, 2620, 2580, 2710, 2840, 2780, 2920, 3010, 3140];
  const wkMax = Math.max(...wks);

  return (
    <ScreenShell scrollable={true}>
      <div style={{ padding: '4px 22px 18px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: TP.ink500, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase' }}>Trailing 12 months</div>
          <div className="tp-display" style={{ fontSize: 28, fontWeight: 700 }}>Reports</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ padding: '7px 11px', borderRadius: 99, background: TP.ink100, fontSize: 12, fontWeight: 600, color: TP.ink700 }}>YTD</div>
          <div style={{ padding: '7px 11px', borderRadius: 99, background: TP.green800, fontSize: 12, fontWeight: 600, color: '#fff' }}>12 mo</div>
        </div>
      </div>

      {/* MRR hero — sparkline */}
      <div style={{ margin: '0 16px 14px', borderRadius: 22, background: 'var(--gradient-hero-deep)', padding: '22px 22px 0', color: '#fff', position: 'relative', overflow: 'hidden', boxShadow: '0 8px 24px -10px hsl(148 75% 12% / 0.5)' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: TP.bronze400 }}>Monthly recurring</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#cfead8', background: 'rgba(255,255,255,0.08)', padding: '3px 8px', borderRadius: 99 }}>
              <Icon name="arrow-up" size={10} stroke={2.4}/> +83% YoY
            </div>
          </div>
          <div className="tp-display tp-num" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1, letterSpacing: -0.04 + 'em' }}>
            $14,820<span style={{ fontSize: 16, color: TP.bronze400, fontWeight: 600 }}>/mo</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#cfead8', marginTop: 6 }}>
            <span className="tp-num" style={{ color: '#fff', fontWeight: 700 }}>+$1,320</span> last 90 days
          </div>
        </div>

        {/* sparkline */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: 70, marginTop: 8, display: 'block' }}>
          <defs>
            <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(30 70% 58%)" stopOpacity="0.45"/>
              <stop offset="100%" stopColor="hsl(30 70% 58%)" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#mrrFill)"/>
          <path d={linePath} fill="none" stroke="hsl(32 75% 65%)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          {pts.map((p, i) => i === pts.length - 1 && (
            <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill="#fff"/>
          ))}
        </svg>

        {/* month labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 0 14px', fontSize: 9.5, color: '#a8c9b7', fontWeight: 600, letterSpacing: 0.5 }}>
          <span>JUN</span><span>SEP</span><span>DEC</span><span>MAR</span><span style={{ color: TP.bronze400 }}>MAY</span>
        </div>
      </div>

      {/* KPI grid */}
      <div style={{ padding: '0 16px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { lbl: 'Weekly route',     val: '$3,140', sub: '+8% vs last wk',  good: true,  ic: 'dollar' },
          { lbl: 'Churn 30d',        val: '2.1%',   sub: '−0.4 pp',         good: true,  ic: 'people' },
          { lbl: '$ per mile',       val: '$13.6',  sub: '+$1.10 vs Apr',   good: true,  ic: 'truck' },
          { lbl: 'Avg stop time',    val: '32m',    sub: '−3m vs Apr',      good: true,  ic: 'clock' },
        ].map((k, i) => (
          <div key={i} style={{ background: TP.card, borderRadius: 14, padding: '12px 13px', border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, color: TP.ink500, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>{k.lbl}</div>
              <div style={{ color: TP.ink400 }}><Icon name={k.ic} size={13} color={TP.ink400}/></div>
            </div>
            <div className="tp-num" style={{ fontSize: 22, fontWeight: 700, color: TP.ink900, marginTop: 4, letterSpacing: -0.02 + 'em' }}>{k.val}</div>
            <div style={{ fontSize: 10.5, color: k.good ? TP.green700 : TP.ink500, fontWeight: 600, marginTop: 1, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name={k.good ? 'arrow-up' : 'arrow-down'} size={9} stroke={2.4}/> {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Weekly route revenue — bar chart */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TP.ink700 }}>Weekly route revenue</div>
          <div style={{ fontSize: 11, color: TP.ink500 }}>last 12 wks</div>
        </div>
        <div style={{ background: TP.card, borderRadius: 14, padding: '16px 14px 14px', border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 96 }}>
            {wks.map((v, i) => {
              const isLast = i === wks.length - 1;
              const h = (v / wkMax) * 100;
              return (
                <div key={i} style={{
                  flex: 1, height: h + '%',
                  background: isLast ? TP.bronze500 : (i >= wks.length - 4 ? TP.green700 : TP.green100),
                  borderRadius: '4px 4px 0 0', position: 'relative',
                }}>
                  {isLast && (
                    <div style={{
                      position: 'absolute', bottom: '100%', left: '50%', transform: 'translate(-50%, -4px)',
                      fontSize: 10, fontWeight: 700, color: TP.bronze600, whiteSpace: 'nowrap',
                    }} className="tp-num">$3.1k</div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed ' + TP.ink100, display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: TP.ink500 }}>
            <span>Mar 3</span><span>·</span><span>Apr 7</span><span>·</span><span>May 5</span><span>·</span><span style={{ color: TP.bronze600, fontWeight: 700 }}>this wk</span>
          </div>
        </div>
      </div>

      {/* Service mix */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 4px 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TP.ink700 }}>Service mix · this month</div>
          <div style={{ fontSize: 11, color: TP.ink500 }}>$14,820</div>
        </div>
        <div style={{ background: TP.card, borderRadius: 14, padding: '14px', border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)' }}>
          {/* stacked bar */}
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ flex: 62, background: TP.green700 }}/>
            <div style={{ flex: 14, background: TP.green500 }}/>
            <div style={{ flex: 12, background: TP.bronze500 }}/>
            <div style={{ flex: 7,  background: TP.bronze400 }}/>
            <div style={{ flex: 5,  background: TP.ink300 }}/>
          </div>
          {/* legend rows */}
          {[
            { c: TP.green700,  lbl: 'Recurring mow',       pct: 62, $: '$9,180' },
            { c: TP.green500,  lbl: 'Edge + trim + blow',  pct: 14, $: '$2,070' },
            { c: TP.bronze500, lbl: 'Fert program',        pct: 12, $: '$1,780' },
            { c: TP.bronze400, lbl: 'Aeration + overseed', pct:  7, $: '$1,030' },
            { c: TP.ink300,    lbl: 'One-off cleanup',     pct:  5, $: '$760'   },
          ].map((row, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: i < 4 ? '1px dashed ' + TP.ink100 : 'none' }}>
              <div style={{ width: 9, height: 9, borderRadius: 2.5, background: row.c }}/>
              <div style={{ flex: 1, fontSize: 12.5, color: TP.ink800, fontWeight: 500 }}>{row.lbl}</div>
              <div className="tp-num" style={{ fontSize: 11, color: TP.ink500, width: 30, textAlign: 'right' }}>{row.pct}%</div>
              <div className="tp-num" style={{ fontSize: 12.5, color: TP.ink900, fontWeight: 600, width: 50, textAlign: 'right' }}>{row.$}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Churn / movements */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ padding: '0 4px 8px', fontSize: 13, fontWeight: 600, color: TP.ink700 }}>Plan movements · 30d</div>
        <div style={{ background: TP.card, borderRadius: 14, padding: '14px', border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: TP.green700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Started</div>
              <div className="tp-num" style={{ fontSize: 22, fontWeight: 700, color: TP.ink900, lineHeight: 1.1 }}>+5</div>
              <div className="tp-num" style={{ fontSize: 11, color: TP.green700, fontWeight: 600 }}>+$540 MRR</div>
            </div>
            <div style={{ width: 1, background: TP.ink200 }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: TP.ink500, letterSpacing: 0.5, textTransform: 'uppercase' }}>Paused</div>
              <div className="tp-num" style={{ fontSize: 22, fontWeight: 700, color: TP.ink900, lineHeight: 1.1 }}>2</div>
              <div className="tp-num" style={{ fontSize: 11, color: TP.ink500, fontWeight: 600 }}>seasonal</div>
            </div>
            <div style={{ width: 1, background: TP.ink200 }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'hsl(0 60% 45%)', letterSpacing: 0.5, textTransform: 'uppercase' }}>Churned</div>
              <div className="tp-num" style={{ fontSize: 22, fontWeight: 700, color: TP.ink900, lineHeight: 1.1 }}>−1</div>
              <div className="tp-num" style={{ fontSize: 11, color: 'hsl(0 60% 45%)', fontWeight: 600 }}>−$220 MRR</div>
            </div>
          </div>
        </div>
      </div>

      <TabBar active="home"/>
    </ScreenShell>
  );
}

Object.assign(window, { ScreenReports });
