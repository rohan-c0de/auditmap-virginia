"use client";

import Link from "next/link";

interface SeniorBannerProps {
  bannerTitle: string;
  bannerSummary: string;
  bannerDetail: string;
}

export default function SeniorBanner({
  bannerTitle,
  bannerSummary,
  bannerDetail,
}: SeniorBannerProps) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-r from-teal-700 via-teal-600 to-cyan-600">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyek0zNiAyNHYySDI0di0yaDEyeiIvPjwvZz48L2c+PC9zdmc+')] opacity-30" />
      <div className="relative mx-auto max-w-4xl px-4 py-10 text-center sm:py-14">
        <p className="mb-1 text-sm font-medium uppercase tracking-wider text-teal-100">
          {bannerTitle}
        </p>
        <h2 className="text-2xl font-bold leading-tight text-white sm:text-3xl md:text-4xl">
          {bannerSummary.replace(" for free.", "")}{" "}
          <span className="text-yellow-300">for free.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base text-teal-50 sm:text-lg">
          {bannerDetail}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="#search"
            className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-teal-700 shadow-md transition hover:bg-teal-50 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-teal-600"
          >
            Find courses near you
            <svg
              className="ml-2 h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </Link>
          <Link
            href="#how-it-works"
            className="inline-flex items-center text-sm font-medium text-teal-100 underline decoration-teal-300 underline-offset-4 transition hover:text-white"
          >
            Learn how it works
          </Link>
        </div>
      </div>
    </section>
  );
}
