"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RowDataPacket } from "mysql2";

import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { pool } from "@/lib/mysql/pool";

export type LoginState = { error: string | null };

interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  password_hash: string;
}

export async function signIn(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!username || !password) {
    return { error: "Enter your username and password." };
  }

  const [rows] = await pool.query<UserRow[]>(
    "SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  const user = rows[0];

  // Deliberately vague: distinguishing "wrong password" from "no such
  // username" tells an attacker which accounts exist.
  if (!user || !verifyPassword(password, user.password_hash)) {
    return { error: "Incorrect username or password." };
  }

  await createSession({ id: user.id, username: user.username });

  revalidatePath("/", "layout");
  // Only allow relative paths — an absolute URL here would be an open redirect.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function signOut() {
  await destroySession();
  revalidatePath("/", "layout");
  redirect("/login");
}
