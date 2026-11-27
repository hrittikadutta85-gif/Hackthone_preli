"use client";
import type { ReactNode } from "react";
import { Tabs } from "@/components/auth/parts";
import { useI18n } from "@/lib/i18n";

export default function AccountLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const tabs = t.auth.account.tabs;
  return (
    <div className="rise">
      <p className="eyebrow mb-3">{t.auth.account.title}</p>
      <Tabs
        items={[
          { href: "/account", label: tabs.profile },
          { href: "/account/notifications", label: tabs.notifications },
          { href: "/account/security", label: tabs.history },
          { href: "/account/sessions", label: tabs.sessions },
        ]}
      />
      {children}
    </div>
  );
}
