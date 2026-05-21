// Shared TurfPro UI primitives — status bar, tab bar, simple icons, small chrome
// All screens render in a 402×874 iOS-shaped container.

const TP = {
  green900: 'var(--green-900)',
  green800: 'var(--green-800)',
  green700: 'var(--green-700)',
  green600: 'var(--green-600)',
  green500: 'var(--green-500)',
  green100: 'var(--green-100)',
  green50:  'var(--green-50)',
  bronze700:'var(--bronze-700)',
  bronze600:'var(--bronze-600)',
  bronze500:'var(--bronze-500)',
  bronze400:'var(--bronze-400)',
  bronze100:'var(--bronze-100)',
  ink900: 'var(--ink-900)',
  ink800: 'var(--ink-800)',
  ink700: 'var(--ink-700)',
  ink500: 'var(--ink-500)',
  ink400: 'var(--ink-400)',
  ink300: 'var(--ink-300)',
  ink200: 'var(--ink-200)',
  ink100: 'var(--ink-100)',
  paper:  'var(--paper)',
  card:   'var(--card)',
  rain:   'var(--rain)',
  rainBg: 'var(--rain-bg)',
  drought:'var(--drought)',
  droughtBg:'var(--drought-bg)',
  ok:     'var(--ok)',
};

// Tiny stroke icons — single-line, 1.6 stroke, 20×20 grid
function Icon({ name, size = 20, color = 'currentColor', stroke = 1.7 }) {
  const props = { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'home': return <svg {...props}><path d="M3 9.5L10 3l7 6.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1V9.5z"/></svg>;
    case 'people': return <svg {...props}><circle cx="7" cy="7.5" r="2.6"/><circle cx="14" cy="8.5" r="2.1"/><path d="M2.5 16c.5-2.4 2.4-3.8 4.5-3.8s4 1.4 4.5 3.8"/><path d="M11.8 16c.4-2.1 2-3.3 3.7-3.3 1.4 0 2.5.7 3 2"/></svg>;
    case 'route': return <svg {...props}><circle cx="5" cy="5" r="1.6"/><circle cx="15" cy="15" r="1.6"/><path d="M5 6.6V11a3 3 0 0 0 3 3h2a3 3 0 0 1 3 3v-3.4"/></svg>;
    case 'plans': return <svg {...props}><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v3M13 2v3"/><circle cx="7" cy="12" r=".7" fill="currentColor"/><circle cx="10" cy="12" r=".7" fill="currentColor"/><circle cx="13" cy="12" r=".7" fill="currentColor"/></svg>;
    case 'settings': return <svg {...props}><circle cx="10" cy="10" r="2.4"/><path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4M15.7 15.7l-1.4-1.4M5.7 5.7L4.3 4.3"/></svg>;
    case 'chevron-right': return <svg {...props}><path d="M7.5 4l6 6-6 6"/></svg>;
    case 'chevron-down': return <svg {...props}><path d="M5 7.5l5 5 5-5"/></svg>;
    case 'plus': return <svg {...props}><path d="M10 4v12M4 10h12"/></svg>;
    case 'check': return <svg {...props}><path d="M4 10.5l4 4 8-9"/></svg>;
    case 'search': return <svg {...props}><circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/></svg>;
    case 'play': return <svg {...props} fill="currentColor" stroke="none"><path d="M5 3.5v13l11-6.5z"/></svg>;
    case 'pin': return <svg {...props}><path d="M10 18s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10z"/><circle cx="10" cy="8" r="2.2"/></svg>;
    case 'truck': return <svg {...props}><rect x="1" y="6" width="11" height="8" rx="1"/><path d="M12 9h4l2 3v2h-6"/><circle cx="5" cy="15" r="1.5"/><circle cx="15" cy="15" r="1.5"/></svg>;
    case 'cloud-rain': return <svg {...props}><path d="M5 12a3.5 3.5 0 0 1 .7-6.9 4.5 4.5 0 0 1 8.6 1A3 3 0 0 1 14 12H5z"/><path d="M7 15l-.5 2M10 15l-.5 2M13 15l-.5 2"/></svg>;
    case 'sun': return <svg {...props}><circle cx="10" cy="10" r="3.4"/><path d="M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17M5 5l1 1M14 14l1 1M15 5l-1 1M6 14l-1 1"/></svg>;
    case 'skip': return <svg {...props}><path d="M4 5l7 5-7 5V5z"/><path d="M14 5v10"/></svg>;
    case 'flag': return <svg {...props}><path d="M5 17V3h9l-1.5 3L14 9H5"/></svg>;
    case 'grip': return <svg {...props} stroke="none" fill="currentColor"><circle cx="8" cy="5" r="1.2"/><circle cx="12" cy="5" r="1.2"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="10" r="1.2"/><circle cx="8" cy="15" r="1.2"/><circle cx="12" cy="15" r="1.2"/></svg>;
    case 'arrow-up': return <svg {...props}><path d="M10 16V4M5 9l5-5 5 5"/></svg>;
    case 'arrow-down': return <svg {...props}><path d="M10 4v12M5 11l5 5 5-5"/></svg>;
    case 'leaf': return <svg {...props}><path d="M16 3c0 7-4 13-11 13 0 0-1-5 2-9s9-4 9-4z"/><path d="M16 3L6 14"/></svg>;
    case 'drop': return <svg {...props}><path d="M10 3s5 5 5 9a5 5 0 0 1-10 0c0-4 5-9 5-9z"/></svg>;
    case 'scissors': return <svg {...props}><circle cx="5" cy="14" r="2"/><circle cx="15" cy="14" r="2"/><path d="M6.5 12.5L16 4M13.5 12.5L4 4"/></svg>;
    case 'phone': return <svg {...props}><path d="M5 3h3l1.5 4-2 1.5a10 10 0 0 0 4 4l1.5-2 4 1.5v3a1 1 0 0 1-1 1c-7 0-12-5-12-12a1 1 0 0 1 1-1z"/></svg>;
    case 'dollar': return <svg {...props}><path d="M10 3v14M13.5 6H8.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4h-5"/></svg>;
    case 'bell': return <svg {...props}><path d="M5 14V9a5 5 0 1 1 10 0v5l1.5 2h-13L5 14z"/><path d="M8.5 17a1.5 1.5 0 0 0 3 0"/></svg>;
    case 'more': return <svg {...props} stroke="none" fill="currentColor"><circle cx="5" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="15" cy="10" r="1.4"/></svg>;
    case 'arrow-left': return <svg {...props}><path d="M15 10H4M9 5l-5 5 5 5"/></svg>;
    case 'note': return <svg {...props}><path d="M5 3h7l3 3v11H5V3z"/><path d="M12 3v3h3"/><path d="M7 9h6M7 12h6M7 15h4"/></svg>;
    case 'sparkle': return <svg {...props}><path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2"/></svg>;
    case 'calc': return <svg {...props}><rect x="4" y="2" width="12" height="16" rx="1.5"/><rect x="6" y="4" width="8" height="3" rx=".5"/><circle cx="7" cy="10" r=".6" fill="currentColor"/><circle cx="10" cy="10" r=".6" fill="currentColor"/><circle cx="13" cy="10" r=".6" fill="currentColor"/><circle cx="7" cy="13" r=".6" fill="currentColor"/><circle cx="10" cy="13" r=".6" fill="currentColor"/><circle cx="13" cy="13" r=".6" fill="currentColor"/><circle cx="7" cy="16" r=".6" fill="currentColor"/><circle cx="10" cy="16" r=".6" fill="currentColor"/></svg>;
    case 'camera': return <svg {...props}><path d="M2 6h3l1.5-2h7L15 6h3v10H2V6z"/><circle cx="10" cy="11" r="3"/></svg>;
    case 'clock': return <svg {...props}><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>;
    case 'mow': return <svg {...props}><rect x="2" y="11" width="9" height="4" rx=".5"/><path d="M11 11V9h3l2-3h2v9h-2"/><circle cx="5" cy="16.5" r="1"/><circle cx="14" cy="16.5" r="1"/></svg>;
    case 'edge': return <svg {...props}><path d="M3 17l8-14"/><path d="M3 17h7"/><circle cx="14" cy="6" r="2"/></svg>;
    default: return <svg {...props}><circle cx="10" cy="10" r="6"/></svg>;
  }
}

// iOS status bar — green or paper variant
function StatusBar({ dark = false }) {
  const c = dark ? '#fff' : TP.ink900;
  return (
    <div style={{
      height: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      padding: '0 28px 8px', position: 'relative', zIndex: 5,
      fontFamily: '-apple-system, "SF Pro Text", system-ui',
    }}>
      <div style={{ fontWeight: 600, fontSize: 16, color: c, letterSpacing: -0.2 }}>9:41</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="17" height="11" viewBox="0 0 17 11">
          <rect x="0" y="6" width="2.8" height="4" rx=".6" fill={c}/>
          <rect x="4.4" y="4" width="2.8" height="6" rx=".6" fill={c}/>
          <rect x="8.8" y="2" width="2.8" height="8" rx=".6" fill={c}/>
          <rect x="13.2" y="0" width="2.8" height="10" rx=".6" fill={c}/>
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3" stroke={c} strokeOpacity=".35" fill="none"/>
          <rect x="2" y="2" width="13" height="8" rx="1.5" fill={c}/>
          <path d="M23 4v4c.7-.3 1.3-1 1.3-2s-.6-1.7-1.3-2z" fill={c} fillOpacity=".4"/>
        </svg>
      </div>
    </div>
  );
}

// Dynamic island
function Island() {
  return (
    <div style={{
      position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
      width: 110, height: 32, borderRadius: 18, background: '#000', zIndex: 30, pointerEvents: 'none',
    }}/>
  );
}

// Home indicator
function HomeIndicator({ dark = false }) {
  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 28, display: 'flex',
      justifyContent: 'center', alignItems: 'flex-end', paddingBottom: 7, zIndex: 30, pointerEvents: 'none' }}>
      <div style={{ width: 120, height: 4, borderRadius: 100, background: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.28)' }}/>
    </div>
  );
}

// Bottom tab bar — Home · Customers · Routes · Plans · Settings (per spec)
function TabBar({ active = 'home' }) {
  const items = [
    { id: 'home',     label: 'Home',      icon: 'home' },
    { id: 'people',   label: 'Customers', icon: 'people' },
    { id: 'route',    label: 'Routes',    icon: 'route' },
    { id: 'plans',    label: 'Plans',     icon: 'plans' },
    { id: 'settings', label: 'Settings',  icon: 'settings' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      paddingBottom: 28, paddingTop: 10,
      background: 'rgba(255,255,255,0.96)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderTop: '0.5px solid ' + TP.ink200,
      display: 'flex', justifyContent: 'space-around', alignItems: 'center',
      zIndex: 20,
    }}>
      {items.map(it => {
        const on = it.id === active;
        return (
          <div key={it.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 56, color: on ? TP.green800 : TP.ink500 }}>
            <Icon name={it.icon} size={22} stroke={on ? 2 : 1.7}/>
            <div style={{ fontSize: 10, fontWeight: on ? 600 : 500, letterSpacing: 0.2 }}>{it.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// Shared screen shell — fixed phone-shape canvas
function ScreenShell({ children, bg = TP.paper, dark = false, scrollable = true }) {
  return (
    <div className="tp-screen tp-ui" style={{ background: bg, position: 'relative' }}>
      <Island/>
      {/* content scroll region */}
      <div style={{
        position: 'absolute', inset: 0,
        overflowY: scrollable ? 'auto' : 'hidden',
        overflowX: 'hidden',
      }}>
        <StatusBar dark={dark}/>
        {children}
        <div style={{ height: 90 }}/>
      </div>
      <HomeIndicator dark={dark}/>
    </div>
  );
}

Object.assign(window, { TP, Icon, StatusBar, Island, HomeIndicator, TabBar, ScreenShell });
