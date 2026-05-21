import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/AppShell";
import Auth from "./pages/Auth";
import Home from "./pages/Home";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import PropertyDetail from "./pages/PropertyDetail";
import RoutesPage from "./pages/Routes";
import RouteMode from "./pages/RouteMode";
import Plans from "./pages/Plans";
import NewPlan from "./pages/NewPlan";
import PlanDetail from "./pages/PlanDetail";
import ApplicationCalc from "./pages/ApplicationCalc";
import ChemicalLog from "./pages/ChemicalLog";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const Protected = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AppShell>{children}</AppShell>
  </ProtectedRoute>
);

// RouteMode is the full-bleed "one screen the operator looks at all morning"
// per spec — it gets no AppShell (no tab bar, no chrome).
const ProtectedFullBleed = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>{children}</ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<Protected><Home /></Protected>} />
          <Route path="/customers" element={<Protected><Customers /></Protected>} />
          <Route path="/customers/:id" element={<Protected><CustomerDetail /></Protected>} />
          <Route path="/properties/:id" element={<Protected><PropertyDetail /></Protected>} />
          <Route path="/routes" element={<Protected><RoutesPage /></Protected>} />
          <Route path="/routes/run/:routeId" element={<ProtectedFullBleed><RouteMode /></ProtectedFullBleed>} />
          <Route path="/plans" element={<Protected><Plans /></Protected>} />
          <Route path="/plans/new" element={<Protected><NewPlan /></Protected>} />
          <Route path="/plans/:id" element={<Protected><PlanDetail /></Protected>} />
          <Route path="/calc" element={<Protected><ApplicationCalc /></Protected>} />
          <Route path="/chem-log" element={<Protected><ChemicalLog /></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
