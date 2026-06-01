import { NextResponse } from "next/server";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import { isValidState } from "@/lib/states/registry";
import { addSubscriber } from "@/lib/subscribers";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(req: Request) {
  const { allowed } = rateLimit(getClientKey(req), 5);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  try {
    const body = await req.json();
    const email = body.email?.trim()?.toLowerCase();
    const state = body.state?.trim()?.toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    if (!state || !isValidState(state)) {
      return NextResponse.json(
        { error: "Invalid state." },
        { status: 400 }
      );
    }

    const { subscriber, alreadyVerified } = await addSubscriber(state, email);

    if (alreadyVerified) {
      return NextResponse.json({
        message: "You're all set — you're already subscribed!",
      });
    }

    try {
      await sendVerificationEmail(email, state, subscriber.token);
    } catch (err) {
      console.error("Failed to send verification email:", err);
      return NextResponse.json(
        {
          error:
            "We couldn't send your confirmation email right now. Please try again in a few minutes.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      message: "Check your inbox to confirm your subscription!",
    });
  } catch (err) {
    console.error("Subscribe error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
