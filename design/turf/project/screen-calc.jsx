// TurfPro — Application Calculator
// Fert / herb rates per 1000 sqft. Granular-vs-liquid math. NPK targets.

function ScreenCalc() {
  return (
    <ScreenShell scrollable={true}>
      <div style={{ padding: '4px 22px 14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, color: TP.ink500, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase' }}>Lawn · 411 Lantana Ave</div>
          <div className="tp-display" style={{ fontSize: 26, fontWeight: 700 }}>Application</div>
        </div>
        <div style={{ width: 38, height: 38, borderRadius: 19, background: TP.ink100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="more" color={TP.ink700} size={18}/>
        </div>
      </div>

      {/* mode toggle: granular / liquid */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ background: TP.ink100, padding: 4, borderRadius: 12, display: 'flex', gap: 4 }}>
          <div style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 9, background: TP.card, fontSize: 13, fontWeight: 700, color: TP.ink900, boxShadow: 'var(--shadow-card)' }}>Granular</div>
          <div style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 9, fontSize: 13, fontWeight: 600, color: TP.ink500 }}>Liquid</div>
        </div>
      </div>

      {/* Product card */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: TP.ink500, letterSpacing: 0.4, textTransform: 'uppercase', padding: '0 4px 8px' }}>Product</div>
        <div style={{
          background: TP.card, borderRadius: 16, padding: '14px',
          border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 11, background: 'linear-gradient(135deg, ' + TP.green600 + ', ' + TP.green800 + ')', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TP.bronze400 }}>
              <Icon name="leaf" size={22} color={TP.bronze400}/>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: TP.ink900 }}>Lesco Pro 24-0-11</div>
              <div style={{ fontSize: 11.5, color: TP.ink500, marginTop: 1 }}>Slow-release · 50 lb bag · $42</div>
            </div>
            <Icon name="chevron-right" size={14} color={TP.ink400}/>
          </div>

          {/* NPK chips */}
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {[
              { n: 'N', v: 24, c: TP.green700 },
              { n: 'P', v: 0,  c: TP.ink500   },
              { n: 'K', v: 11, c: TP.bronze600},
            ].map(x => (
              <div key={x.n} style={{ flex: 1, background: TP.ink100, borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: x.c, letterSpacing: 0.5 }}>{x.n}</div>
                <div className="tp-num" style={{ fontSize: 17, fontWeight: 700, color: TP.ink900 }}>{x.v}<span style={{ fontSize: 10, color: TP.ink500, fontWeight: 500 }}>%</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Inputs — area + rate */}
      <div style={{ padding: '0 16px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: TP.card, borderRadius: 14, padding: '12px 14px', border: '1px solid ' + TP.ink100 }}>
          <div style={{ fontSize: 11, color: TP.ink500, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>Lawn area</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <div className="tp-num" style={{ fontSize: 24, fontWeight: 700, color: TP.ink900 }}>7,200</div>
            <div style={{ fontSize: 12, color: TP.ink500, fontWeight: 600 }}>ft²</div>
          </div>
          <div style={{ fontSize: 10.5, color: TP.green700, fontWeight: 600, marginTop: 2 }}>from property record</div>
        </div>
        <div style={{ background: TP.card, borderRadius: 14, padding: '12px 14px', border: '1px solid ' + TP.ink100 }}>
          <div style={{ fontSize: 11, color: TP.ink500, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>Target N rate</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <div className="tp-num" style={{ fontSize: 24, fontWeight: 700, color: TP.ink900 }}>1.0</div>
            <div style={{ fontSize: 11, color: TP.ink500, fontWeight: 600 }}>lb N/1k</div>
          </div>
          <div style={{ fontSize: 10.5, color: TP.ink500, marginTop: 2 }}>Step 2 of 5</div>
        </div>
      </div>

      {/* slider — N rate */}
      <div style={{ padding: '0 16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: TP.ink500, padding: '0 2px 6px' }}>
          <span>0.5</span><span>0.75</span><span style={{ color: TP.bronze600, fontWeight: 700 }}>1.0</span><span>1.25</span><span>1.5</span>
        </div>
        <div style={{ position: 'relative', height: 10, background: TP.ink100, borderRadius: 5 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '50%', background: 'linear-gradient(90deg, ' + TP.green500 + ', ' + TP.green700 + ')', borderRadius: 5 }}/>
          <div style={{ position: 'absolute', left: 'calc(50% - 12px)', top: -7, width: 24, height: 24, borderRadius: 12, background: TP.bronze500, border: '3px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}/>
        </div>
      </div>

      {/* The big result card */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{
          background: TP.green900, borderRadius: 22, padding: '22px',
          color: '#fff', position: 'relative', overflow: 'hidden',
          backgroundImage: 'var(--gradient-hero-deep)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: TP.bronze400 }}>Apply this visit</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
            <div className="tp-display tp-num" style={{ fontSize: 56, fontWeight: 700, lineHeight: 1, letterSpacing: -0.03 + 'em' }}>30.0</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#cfead8' }}>lb</div>
          </div>
          <div style={{ fontSize: 13, color: '#cfead8', marginTop: 4 }}>
            ≈ <span className="tp-num" style={{ fontWeight: 700, color: '#fff' }}>0.6</span> of a 50 lb bag
          </div>

          {/* spreader */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', justifyContent: 'space-between', gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: '#a8c9b7', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Spreader</div>
              <div className="tp-num" style={{ fontSize: 18, fontWeight: 700, marginTop: 1 }}>setting <span style={{ color: TP.bronze400 }}>F</span></div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#a8c9b7', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Coverage</div>
              <div className="tp-num" style={{ fontSize: 18, fontWeight: 700, marginTop: 1 }}>4.2 <span style={{ fontSize: 11, fontWeight: 500, color: '#cfead8' }}>lb/k</span></div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#a8c9b7', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Cost</div>
              <div className="tp-num" style={{ fontSize: 18, fontWeight: 700, marginTop: 1 }}>$25.20</div>
            </div>
          </div>
        </div>
      </div>

      {/* Safety strip */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ background: TP.bronze100, border: '1px solid ' + TP.bronze100, borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="sparkle" size={16} color={TP.bronze700}/>
          <div style={{ flex: 1, fontSize: 12, color: TP.bronze700 }}>
            <b>Pet-safe property.</b> Re-entry: 24 h after watering in. Flag posted at curb.
          </div>
        </div>
      </div>

      {/* Save to log */}
      <div style={{ padding: '0 16px' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ flex: 1, padding: '14px', borderRadius: 14, background: TP.card, color: TP.ink900, border: '1px solid ' + TP.ink200, fontWeight: 600, fontSize: 14 }}>
            Recalc
          </button>
          <button style={{ flex: 2, padding: '14px', borderRadius: 14, background: TP.green800, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="check" size={16}/> Save to chemical log
          </button>
        </div>
      </div>

      <TabBar active="home"/>
    </ScreenShell>
  );
}

Object.assign(window, { ScreenCalc });
