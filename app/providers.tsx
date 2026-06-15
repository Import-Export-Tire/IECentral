"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AuthProvider } from "./auth-context";
import { ThemeProvider } from "./theme-context";
import { AppearanceProvider } from "./appearance-context";
import { SidebarProvider } from "./sidebar-context";
import AppShell from "@/components/shell/AppShell";
import GlobalSearch from "@/components/GlobalSearch";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import SystemBanner from "@/components/SystemBanner";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import PushNotificationPrompt from "@/components/PushNotificationPrompt";

// Production deployment
const convex = new ConvexReactClient(
  "https://outstanding-dalmatian-787.convex.cloud"
);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProvider client={convex}>
      <ThemeProvider>
        <AppearanceProvider>
          <SidebarProvider>
            <AuthProvider>
              <AppShell>
                <ImpersonationBanner />
                <SystemBanner />
                {children}
                <GlobalSearch />
                <KeyboardShortcuts />
                <PushNotificationPrompt />
              </AppShell>
            </AuthProvider>
          </SidebarProvider>
        </AppearanceProvider>
      </ThemeProvider>
    </ConvexProvider>
  );
}
