import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";

// Eagerly-loaded routes: anything an authenticated user lands on within the
// first few seconds (Home, the tab-bar destinations, Auth). Splitting these
// adds spinner flicker without saving real bytes.
import Auth from "./pages/Auth";
import Home from "./pages/Home";
import Test from "./pages/Test";
import SignOut from "./pages/SignOut";
import Customers from "./pages/Customers";
import RoutesPage from "./pages/Routes";
import Plans from "./pages/Plans";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import RequireSubscription from "./components/billing/RequireSubscription";
import RequireOnboarded from "./components/onboarding/RequireOnboarded";

// Lazy-loaded routes: heavy deps (recharts on Reports, Stripe Elements on
// Pricing/CheckoutReturn) or rare destinations (PhotoDetail, public flows).
// Each gets pulled in on first navigation; ~400 KB of recharts alone moves out
// of the main bundle. Order roughly by "how often the operator hits this".
const Reports = lazy(() => import("./pages/Reports"));
const Pricing = lazy(() => import("./pages/Pricing"));
const CheckoutReturn = lazy(() => import("./pages/CheckoutReturn"));
const RouteMode = lazy(() => import("./pages/RouteMode"));
const ApplicationCalc = lazy(() => import("./pages/ApplicationCalc"));
const ChemicalLog = lazy(() => import("./pages/ChemicalLog"));
const Photos = lazy(() => import("./pages/Photos"));
const NewPhotoPair = lazy(() => import("./pages/NewPhotoPair"));
const PhotoDetail = lazy(() => import("./pages/PhotoDetail"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const PropertyDetail = lazy(() => import("./pages/PropertyDetail"));
const NewPlan = lazy(() => import("./pages/NewPlan"));
const PlanDetail = lazy(() => import("./pages/PlanDetail"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Accept = lazy(() => import("./pages/Accept"));
const QuotePrint = lazy(() => import("./pages/QuotePrint"));
const Review = lazy(() => import("./pages/Review"));
const PlanPortal = lazy(() => import("./pages/PlanPortal"));
const PlanPortalDone = lazy(() =>
  import("./pages/PlanPortal").then((m) => ({ default: m.PlanPortalDone })),
);
const ShortLink = lazy(() => import("./pages/ShortLink"));
const Gallery = lazy(() => import("./pages/Gallery"));
const Quotes = lazy(() => import("./pages/Quotes"));
const NewQuote = lazy(() => import("./pages/NewQuote"));
const QuoteDetail = lazy(() => import("./pages/QuoteDetail"));
const Campaigns = lazy(() => import("./pages/Campaigns"));

const queryClient = new QueryClient();

const Protected = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <RequireOnboarded>
      <AppShell>{children}</AppShell>
    </RequireOnboarded>
  </ProtectedRoute>
);

// RouteMode is the full-bleed "one screen the operator looks at all morning"
// per spec — it gets no AppShell (no tab bar, no chrome).
const ProtectedFullBleed = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>{children}</ProtectedRoute>
);

// Gated routes — subscription required after the trial window. The
// RequireSubscription component is stub-passthrough until the Paywall agent
// fills in the real check; wrapping all gated routes here means swapping the
// component implementation activates the gate everywhere at once.
const Paid = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <RequireOnboarded>
      <RequireSubscription>
        <AppShell>{children}</AppShell>
      </RequireSubscription>
    </RequireOnboarded>
  </ProtectedRoute>
);

// Centered spinner used while a lazy route's chunk is downloading. Keeps the
// background color so the screen doesn't flash white between routes.
const RouteSuspense = () => (
  <div className="min-h-screen grid place-items-center bg-background">
    <Loader2 className="h-6 w-6 animate-spin text-ink-400" strokeWidth={2} />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<RouteSuspense />}>
        <Routes>
          <Route path="/test" element={<Test />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/signout" element={<SignOut />} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          {/* Public — customer-facing flows, no auth required */}
          <Route path="/accept/:id" element={<Accept />} />
          <Route path="/accept/:id/print" element={<QuotePrint />} />
          <Route path="/plans/portal/:token" element={<PlanPortal />} />
          <Route path="/plans/portal/:token/done" element={<PlanPortalDone />} />
          <Route path="/review/:id" element={<Review />} />
          <Route path="/s/:code" element={<ShortLink />} />
          <Route path="/g/:propertyId" element={<Gallery />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/checkout/return" element={<Protected><CheckoutReturn /></Protected>} />
          <Route path="/" element={<Protected><Home /></Protected>} />
          <Route path="/customers" element={<Protected><Customers /></Protected>} />
          <Route path="/customers/:id" element={<Protected><CustomerDetail /></Protected>} />
          <Route path="/properties/:id" element={<Protected><PropertyDetail /></Protected>} />
          <Route path="/routes" element={<Paid><RoutesPage /></Paid>} />
          <Route path="/routes/run/:routeId" element={<ProtectedFullBleed><RouteMode /></ProtectedFullBleed>} />
          <Route path="/plans" element={<Paid><Plans /></Paid>} />
          <Route path="/plans/new" element={<Paid><NewPlan /></Paid>} />
          <Route path="/plans/:id" element={<Paid><PlanDetail /></Paid>} />
          <Route path="/reports" element={<Paid><Reports /></Paid>} />
          <Route path="/quotes" element={<Protected><Quotes /></Protected>} />
          <Route path="/quotes/new" element={<Protected><NewQuote /></Protected>} />
          <Route path="/quotes/:id" element={<Protected><QuoteDetail /></Protected>} />
          <Route path="/campaigns" element={<Protected><Campaigns /></Protected>} />
          <Route path="/calc" element={<Protected><ApplicationCalc /></Protected>} />
          <Route path="/chem-log" element={<Protected><ChemicalLog /></Protected>} />
          <Route path="/photos" element={<Protected><Photos /></Protected>} />
          <Route path="/photos/new" element={<Protected><NewPhotoPair /></Protected>} />
          <Route path="/photos/:id" element={<Protected><PhotoDetail /></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
