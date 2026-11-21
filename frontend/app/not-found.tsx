import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <div className="text-5xl" aria-hidden>
        🦟
      </div>
      <h1 className="font-display mt-4 text-3xl font-semibold">This page flew away.</h1>
      <p className="mt-2 text-muted">The address may be wrong, or the ward doesn&apos;t exist.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="rounded-full bg-accent px-5 py-2 font-semibold text-white shadow hover:shadow-md">
          Go to the city overview
        </Link>
        <Link href="/map" className="rounded-full border border-line px-5 py-2 font-medium hover:border-accent/50">
          Open the risk map
        </Link>
      </div>
    </div>
  );
}
