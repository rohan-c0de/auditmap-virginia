"use client";

import { useState } from "react";

export default function NotifyBanner({ nextTerm, state }: { nextTerm: string; state: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, state }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("success");
        setMessage(data.message);
        setEmail("");
      } else {
        setStatus("error");
        setMessage(data.error);
      }
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 text-sm text-teal-800">
        {message}
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-4">
      <p className="text-sm font-medium text-amber-900 mb-2">
        {`${nextTerm} schedules aren't posted yet.`}
      </p>
      <p className="text-xs text-amber-700 mb-3">
        Get notified when new semester schedules become available.
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setStatus("idle"); }}
          className="flex-1 min-w-0 rounded-md border border-amber-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          required
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 whitespace-nowrap"
        >
          {status === "loading" ? "..." : "Notify Me"}
        </button>
      </form>
      {status === "error" && (
        <p className="mt-2 text-xs text-red-600">{message}</p>
      )}
      <p className="mt-2 text-[11px] text-amber-600">
        We&apos;ll only email you about new schedules. No spam.{" "}
        <a href="/privacy" className="underline">Privacy policy</a>.
      </p>
    </div>
  );
}
