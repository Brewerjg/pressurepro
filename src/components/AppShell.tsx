import { ReactNode } from "react";
import { TabBar } from "./TabBar";

interface AppShellProps {
  children: ReactNode;
}

export const AppShell = ({ children }: AppShellProps) => {
  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-md mx-auto pb-28">{children}</main>
      <TabBar />
    </div>
  );
};
