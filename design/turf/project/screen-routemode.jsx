// TurfPro — Route Mode (full-bleed)
// "The one screen the operator looks at all morning."
// Big address, big map link, big Mark done. Spartan.

function ScreenRouteMode() {
  return (
    <div className="tp-screen tp-ui" style={{ background: TP.green900, color: '#fff', position: 'relative' }}>
      <Island/>
      <div style={{ position: 'absolute', inset: 0, background: 'var(--gradient-hero-deep)' }}/>
      {/* subtle texture */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.05, backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 18px)' }}/>

      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        <StatusBar dark={true}/>

        {/* top — stop counter + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 19, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="arrow-left" color="#fff" size={18}/>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: TP.bronze400, letterSpacing: 0.8, textTransform: 'uppercase' }}>Stop</div>
              <div className="tp-num" style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>4 of 11</div>
            </div>
          </div>
          <div style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.08)', borderRadius: 99, fontSize: 11.5, fontWeight: 600, color: '#cfead8', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: TP.bronze500 }}/>
            On site · 08:42
          </div>
        </div>

        {/* mini progress segments */}
        <div style={{ display: 'flex', gap: 3, padding: '14px 20px 0' }}>
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < 3 ? TP.green500 : i === 3 ? TP.bronze500 : 'rgba(255,255,255,0.12)' }}/>
          ))}
        </div>

        {/* big address */}
        <div style={{ padding: '24px 24px 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, color: TP.bronze400, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>Current stop</div>
          <div className="tp-display" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.05, letterSpacing: -0.02 + 'em', color: '#fff' }}>
            411 Lantana<br/>Avenue
          </div>
          <div style={{ fontSize: 15, color: '#cfead8', marginTop: 8, fontWeight: 500 }}>
            Marisol Carrington · Maple Heights
          </div>

          {/* service chips */}
          <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
            <div style={{ padding: '8px 14px 8px 12px', borderRadius: 99, background: 'rgba(255,255,255,0.1)', fontSize: 13, fontWeight: 600, color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="mow" size={14} color={TP.bronze400}/> Weekly mow
            </div>
            <div style={{ padding: '8px 14px 8px 12px', borderRadius: 99, background: 'rgba(255,255,255,0.1)', fontSize: 13, fontWeight: 600, color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="edge" size={14} color={TP.bronze400}/> Edge
            </div>
            <div style={{ padding: '8px 14px', borderRadius: 99, background: 'rgba(255,255,255,0.1)', fontSize: 13, fontWeight: 700, color: TP.bronze400, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              $55
            </div>
          </div>

          <div style={{ flex: 1 }}/>

          {/* Map / call duo */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <button style={{
              flex: 1, padding: '15px 14px', borderRadius: 16, background: 'rgba(255,255,255,0.08)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.14)', fontWeight: 600, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Icon name="pin" size={18}/> Open in Maps
            </button>
            <button style={{
              width: 56, height: 'auto', borderRadius: 16, background: 'rgba(255,255,255,0.08)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="phone" size={18}/>
            </button>
            <button style={{
              width: 56, height: 'auto', borderRadius: 16, background: 'rgba(255,255,255,0.08)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="camera" size={18}/>
            </button>
          </div>

          {/* The big button */}
          <button style={{
            padding: '22px', borderRadius: 20, background: TP.bronze500, color: '#fff',
            border: 'none', fontWeight: 700, fontSize: 20, letterSpacing: 0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            boxShadow: '0 12px 32px -8px hsl(30 70% 45% / 0.7), inset 0 1px 0 rgba(255,255,255,0.2)',
          }}>
            <Icon name="check" size={22} stroke={2.4}/> Mark done
          </button>

          {/* swipe hint */}
          <div style={{ textAlign: 'center', padding: '14px 0 8px', color: '#cfead8', opacity: 0.7, fontSize: 12, fontWeight: 500 }}>
            Swipe up for notes
          </div>
        </div>

        {/* Notes pull-up — sneak peek */}
        <div style={{
          background: 'rgba(0,0,0,0.25)', borderTop: '1px solid rgba(255,255,255,0.08)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '8px 20px 36px',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.25)', margin: '0 auto 12px' }}/>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.08)', fontSize: 12.5, color: '#fff', fontWeight: 500 }}>
              <span style={{ color: TP.bronze400, fontWeight: 700 }}>🔒</span>
              <span>Gate code <b className="tp-num">4127</b></span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.08)', fontSize: 12.5, color: '#fff', fontWeight: 500 }}>
              <span>🐕</span><span>Golden — friendly</span>
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 12, background: 'hsl(36 80% 30%)', color: '#fff', fontSize: 12.5, fontWeight: 600 }}>
              <span>🌱</span><span>Pet-safe chem only</span>
            </div>
          </div>
        </div>
      </div>

      <HomeIndicator dark={true}/>
    </div>
  );
}

Object.assign(window, { ScreenRouteMode });
