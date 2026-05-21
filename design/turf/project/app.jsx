// TurfPro — main canvas + tweaks
// Drops each screen into an iPhone-shaped artboard. Tweaks let you swap
// Home directions and accent palettes.

function PhoneFrame({ children, dark = false }) {
  return (
    <div style={{
      width: 402, height: 874, borderRadius: 54, overflow: 'hidden',
      position: 'relative',
      background: dark ? '#000' : '#fff',
      boxShadow: '0 0 0 12px #1a1a1a, 0 0 0 13px #2a2a2a, 0 30px 60px -20px rgba(0,0,0,0.3)',
    }}>
      {children}
    </div>
  );
}

// Accent palettes — each tweak option sets the --bronze-* vars used by all
// screens. The default is the spec's "trophy bronze". Hex previews used in
// the TweakColor chip; runtime tokens use the more precise HSL below.
const ACCENT_HEX = {
  bronze: ['#d07e22', '#5a3115', '#ebd5b8'],
  copper: ['#db6a3a', '#74321b', '#ecd5c6'],
  gold:   ['#eaad14', '#7d5a14', '#ecddb6'],
  sage:   ['#5da336', '#2e5519', '#d5e6c4'],
};
const ACCENT_PALETTES = {
  bronze:  { 700: '26 60% 28%', 600: '28 65% 38%', 500: '30 70% 48%', 400: '32 75% 58%', 100: '32 60% 92%' },
  copper:  { 700: '12 55% 32%', 600: '14 60% 42%', 500: '16 70% 52%', 400: '18 78% 62%', 100: '18 60% 92%' },
  gold:    { 700: '40 70% 30%', 600: '42 78% 42%', 500: '44 85% 52%', 400: '46 88% 62%', 100: '46 70% 92%' },
  sage:    { 700: '95 60% 25%', 600: '95 55% 35%', 500: '95 50% 45%', 400: '95 45% 55%', 100: '85 35% 92%' },
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "bronze",
  "homeStyle": "hero",
  "showReports": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Drive accent palette → CSS variables on :root
  React.useEffect(() => {
    const pal = ACCENT_PALETTES[t.accent] || ACCENT_PALETTES.bronze;
    const r = document.documentElement;
    r.style.setProperty('--bronze-700', `hsl(${pal[700]})`);
    r.style.setProperty('--bronze-600', `hsl(${pal[600]})`);
    r.style.setProperty('--bronze-500', `hsl(${pal[500]})`);
    r.style.setProperty('--bronze-400', `hsl(${pal[400]})`);
    r.style.setProperty('--bronze-100', `hsl(${pal[100]})`);
    r.style.setProperty('--shadow-bronze', `0 8px 24px -8px hsl(${pal[500]} / 0.55)`);
  }, [t.accent]);

  const HomeChoice = t.homeStyle === 'tabular' ? ScreenHomeAlt : ScreenHome;
  const homeLabel = t.homeStyle === 'tabular' ? 'Home · tabular' : 'Home · MRR-first';

  return (
    <>
      <DesignCanvas>
        <DCSection id="ops" title="Daily operations" subtitle="Headline number is MRR (not pipeline). Today's route is the primary loop.">
          <DCArtboard id="home" label={homeLabel} width={402} height={874}>
            <PhoneFrame><HomeChoice/></PhoneFrame>
          </DCArtboard>
          <DCArtboard id="routes" label="Routes · week + day" width={402} height={874}>
            <PhoneFrame><ScreenRoutes/></PhoneFrame>
          </DCArtboard>
          <DCArtboard id="routemode" label="Route mode · full-bleed" width={402} height={874}>
            <PhoneFrame dark><ScreenRouteMode/></PhoneFrame>
          </DCArtboard>
        </DCSection>

        <DCSection id="catalog" title="Customer graph" subtitle="Same customer/property schema as PressurePro. Recurring is the default surface.">
          <DCArtboard id="plans" label="Plans · primary tab" width={402} height={874}>
            <PhoneFrame><ScreenPlans/></PhoneFrame>
          </DCArtboard>
          <DCArtboard id="customers" label="Customers · A–Z" width={402} height={874}>
            <PhoneFrame><ScreenCustomers/></PhoneFrame>
          </DCArtboard>
          <DCArtboard id="calc" label="Application calc · NPK" width={402} height={874}>
            <PhoneFrame><ScreenCalc/></PhoneFrame>
          </DCArtboard>
        </DCSection>

        {t.showReports && (
          <DCSection id="reports" title="Reports" subtitle="MRR-first dashboard, then weekly revenue, churn, drive efficiency.">
            <DCArtboard id="reports" label="Reports · MRR-first" width={402} height={874}>
              <PhoneFrame><ScreenReports/></PhoneFrame>
            </DCArtboard>
          </DCSection>
        )}
      </DesignCanvas>

      <TweaksPanel title="TurfPro tweaks">
        <TweakSection label="Theme"/>
        <TweakColor label="Accent" value={ACCENT_HEX[t.accent]}
          options={[ACCENT_HEX.bronze, ACCENT_HEX.copper, ACCENT_HEX.gold, ACCENT_HEX.sage]}
          onChange={(arr) => {
            const name = Object.keys(ACCENT_HEX).find(k => ACCENT_HEX[k][0] === arr[0]) || 'bronze';
            setTweak('accent', name);
          }}/>

        <TweakSection label="Layout direction"/>
        <TweakRadio label="Home style" value={t.homeStyle}
          options={[
            { value: 'hero',    label: 'Hero' },
            { value: 'tabular', label: 'Tabular' },
          ]}
          onChange={(v) => setTweak('homeStyle', v)}/>

        <TweakSection label="Canvas"/>
        <TweakToggle label="Show Reports" value={t.showReports}
          onChange={(v) => setTweak('showReports', v)}/>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
