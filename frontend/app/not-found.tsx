"use client";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-xl py-10 text-center sm:py-16">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-accent/40 bg-accent-soft text-accent">
        <Icon name="radar" className="h-9 w-9" />
      </div>
      <h1 className="font-display mt-5 text-2xl font-semibold sm:text-3xl">{t.notFound.title}</h1>
      <p className="mt-2 text-muted">{t.notFound.text}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn btn-primary !px-5 !py-2">
          {t.notFound.home}
        </Link>
        <Link href="/map" className="btn !px-5 !py-2">
          {t.notFound.map}
        </Link>
      </div>
    </div>
  );
}
