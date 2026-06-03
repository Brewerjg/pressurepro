import { ReactNode } from "react";
import { TabBar } from "./TabBar";
import TrialBanner from "./billing/TrialBanner";
import { DemoBanner } from "./DemoBanner";

interface AppShellProps {
  children: ReactNode;
}

export const AppShell = ({ children }: AppShellProps) => {
  return (
    <div className="min-h-screen bg-background">
      {/* Demo banner for demo accounts */}
      <DemoBanner />
      {/* TrialBanner self-hides on active subs and pre-auth — see component. */}
      <div className="max-w-md mx-auto">
        <TrialBanner />
      </div>
      <main className="max-w-md mx-auto pb-28">{children}</main>
      <TabBar />
    </div>
  );
};
