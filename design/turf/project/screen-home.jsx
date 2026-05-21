// TurfPro — Home screen
// Recurring-first ops app. Headline is MRR (not pipeline) per spec.

function ScreenHome() {
  return (
    <ScreenShell scrollable={true}>
      {/* Top header — minimal */}
      <div style={{ padding: '4px 22px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: TP.ink500, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase' }}>Wednesday · May 20</div>
          <div className="tp-display" style={{ fontSize: 24, fontWeight: 700, color: TP.ink900, marginTop: 2, letterSpacing: -0.02 + 'em', whiteSpace: 'nowrap' }}>Good morning, Mike</div>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 20, border: '1px solid ' + TP.ink200, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', background: TP.card }}>
          <Icon name="bell" color={TP.ink700} size={18}/>
          <div style={{ position: 'absolute', top: 9, right: 11, width: 6, height: 6, borderRadius: 3, background: TP.bronze500 }}/>
        </div>
      </div>

      {/* MRR hero card — deep green gradient */}
      <div style={{ margin: '0 16px 14px', borderRadius: 22, background: 'var(--gradient-hero-deep)', padding: '20px 22px 22px', color: '#fff', boxShadow: '0 8px 24px -10px hsl(148 75% 12% / 0.5)', position: 'relative', overflow: 'hidden' }}>
        {/* subtle texture */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.07, backgroundImage: 'repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 14px)' }}/>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: TP.bronze400 }}>Monthly recurring</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#cfead8', background: 'rgba(255,255,255,0.08)', padding: '4px 8px', borderRadius: 99 }}>
              <Icon name="arrow-up" size={11} stroke={2.2}/> +8.4% mo/mo
            </div>
          </div>
          <div className="tp-display tp-num" style={{ fontSize: 48, fontWeight: 700, lineHeight: 1, letterSpacing: -0.04 + 'em' }}>
            $14,820
            <span style={{ fontSize: 18, color: TP.bronze400, fontWeight: 600, marginLeft: 4 }}>/mo</span>
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
            <div>
              <div className="tp-num" style={{ fontSize: 18, fontWeight: 600 }}>67</div>
              <div style={{ fontSize: 11, color: '#a8c9b7', marginTop: 1 }}>Active plans</div>
            </div>
            <div>
              <div className="tp-num" style={{ fontSize: 18, fontWeight: 600 }}>2.1%</div>
              <div style={{ fontSize: 11, color: '#a8c9b7', marginTop: 1 }}>Churn 30d</div>
            </div>
            <div>
              <div className="tp-num" style={{ fontSize: 18, fontWeight: 600 }}>$221</div>
              <div style={{ fontSize: 11, color: '#a8c9b7', marginTop: 1 }}>Avg/customer</div>
            </div>
          </div>
        </div>
      </div>

      {/* Today's route — primary action */}
      <div style={{ margin: '0 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TP.ink700, letterSpacing: 0.2 }}>Today's route</div>
          <div style={{ fontSize: 12, color: TP.ink500 }}>Wednesday crew</div>
        </div>
        <div style={{ background: TP.card, borderRadius: 18, padding: 16, boxShadow: 'var(--shadow-card)', border: '1px solid ' + TP.ink100 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 18 }}>
              <div>
                <div className="tp-num" style={{ fontSize: 22, fontWeight: 700, color: TP.ink900 }}>11</div>
                <div style={{ fontSize: 11, color: TP.ink500, marginTop: -2 }}>stops</div>
              </div>
              <div style={{ width: 1, background: TP.ink200 }}/>
              <div>
                <div className="tp-num" style={{ fontSize: 22, fontWeight: 700, color: TP.ink900 }}>23<span style={{ fontSize: 13, color: TP.ink500, fontWeight: 500 }}> mi</span></div>
                <div style={{ fontSize: 11, color: TP.ink500, marginTop: -2 }}>drive total</div>
              </div>
              <div style={{ width: 1, background: TP.ink200 }}/>
              <div>
                <div className="tp-num" style={{ fontSize: 22, fontWeight: 700, color: TP.ink900 }}>6.5<span style={{ fontSize: 13, color: TP.ink500, fontWeight: 500 }}> h</span></div>
                <div style={{ fontSize: 11, color: TP.ink500, marginTop: -2 }}>est.</div>
              </div>
            </div>
          </div>

          {/* mini progress strip */}
          <div style={{ display: 'flex', gap: 3, marginBottom: 14 }}>
            {Array.from({ length: 11 }).map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 6, borderRadius: 3,
                background: i < 3 ? TP.green600 : i === 3 ? TP.bronze500 : TP.ink100,
              }}/>
            ))}
          </div>

          {/* Next stop preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: TP.green50, borderRadius: 12, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: TP.green800, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>4</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: TP.green700, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>Up next</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: TP.ink900 }}>411 Lantana Ave</div>
            </div>
            <div style={{ fontSize: 11, color: TP.green700, fontWeight: 600 }}>2 mi · 7 min</div>
          </div>

          <button style={{ width: '100%', padding: '14px', borderRadius: 14, background: TP.bronze500, color: '#fff', border: 'none', fontWeight: 700, fontSize: 15, letterSpacing: 0.2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: 'var(--shadow-bronze)' }}>
            <Icon name="play" size={14}/> Start route
          </button>
        </div>
      </div>

      {/* Forecast strip — rain skip / drought */}
      <div style={{ margin: '14px 16px 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: TP.ink700, letterSpacing: 0.2, padding: '0 4px 8px' }}>This week</div>
        <div style={{ background: TP.card, borderRadius: 16, padding: '12px 8px', boxShadow: 'var(--shadow-card)', border: '1px solid ' + TP.ink100, display: 'flex' }}>
          {[
            { d: 'Mon', n: 19, w: 'sun', tone: 'ok' },
            { d: 'Tue', n: 20, w: 'sun', tone: 'ok' },
            { d: 'Wed', n: 21, w: 'sun', tone: 'today' },
            { d: 'Thu', n: 22, w: 'cloud-rain', tone: 'rain' },
            { d: 'Fri', n: 23, w: 'sun', tone: 'drought' },
            { d: 'Sat', n: 24, w: 'sun', tone: 'ok' },
            { d: 'Sun', n: 25, w: 'sun', tone: 'ok' },
          ].map((day, i) => {
            const tones = {
              ok:      { bg: 'transparent', fg: TP.ink700,  ic: TP.ink400 },
              today:   { bg: TP.green800,   fg: '#fff',     ic: TP.bronze400 },
              rain:    { bg: TP.rainBg,     fg: TP.rain,    ic: TP.rain },
              drought: { bg: TP.droughtBg,  fg: TP.drought, ic: TP.drought },
            }[day.tone];
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '6px 0', borderRadius: 12, background: tones.bg }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: tones.fg, opacity: 0.7, letterSpacing: 0.3 }}>{day.d.toUpperCase()}</div>
                <Icon name={day.w} size={16} color={tones.ic}/>
                <div className="tp-num" style={{ fontSize: 13, fontWeight: 700, color: tones.fg }}>{day.n}°</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, padding: '0 4px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px 5px 7px', background: TP.rainBg, borderRadius: 99, fontSize: 11.5, color: TP.rain, fontWeight: 600 }}>
            <Icon name="cloud-rain" size={12}/> Skip Thursday · 4 stops
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px 5px 7px', background: TP.droughtBg, borderRadius: 99, fontSize: 11.5, color: 'hsl(36 80% 35%)', fontWeight: 600 }}>
            <Icon name="sun" size={12}/> Stretch Fri to biweekly
          </div>
        </div>
      </div>

      {/* Quick tiles */}
      <div style={{ margin: '14px 16px 4px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: TP.ink700, padding: '0 4px 8px' }}>Quick actions</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { icon: 'camera',   label: 'Photo pair',    sub: 'Before / after',     accent: TP.green600 },
            { icon: 'calc',     label: 'Application',   sub: 'NPK · per 1000ft²',  accent: TP.bronze600 },
            { icon: 'note',     label: 'Chemical log',  sub: '3 entries this wk',  accent: TP.green700 },
            { icon: 'dollar',   label: 'One-off quote', sub: 'Spring cleanup +',    accent: TP.ink700 },
          ].map((t, i) => (
            <div key={i} style={{ background: TP.card, borderRadius: 14, padding: '14px 14px 12px', border: '1px solid ' + TP.ink100, boxShadow: 'var(--shadow-card)' }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: TP.ink100, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10, color: t.accent }}>
                <Icon name={t.icon} size={16} color={t.accent}/>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: TP.ink900 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: TP.ink500, marginTop: 1 }}>{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <TabBar active="home"/>
    </ScreenShell>
  );
}

Object.assign(window, { ScreenHome });
