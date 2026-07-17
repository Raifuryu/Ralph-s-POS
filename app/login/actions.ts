"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

export async function signIn(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  // Injected by the Turnstile widget itself.
  const captchaToken = String(formData.get("cf-turnstile-response") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    // Ignored by Supabase unless CAPTCHA protection is enabled in the
    // dashboard with the matching secret key.
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });

  if (error) {
    // Deliberately vague: distinguishing "wrong password" from "no such user"
    // tells an attacker which emails are registered.
    return { error: "Incorrect email or password." };
  }

  revalidatePath("/", "layout");
  // Only allow relative paths — an absolute URL here would be an open redirect.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
