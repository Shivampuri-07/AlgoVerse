import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionValue } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/auth/shared";
import { isAdminConfigured } from "@/lib/firebase/admin";
import { getProfile } from "@/lib/account/profile";
import { AccountView } from "@/components/account/account-view";
import { AccountSetupRequired } from "@/components/account/setup-notice";

export const metadata: Metadata = { title: "Account", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Protected page: the session cookie is verified on the server (signature, expiry and
 * revocation) before anything personal is rendered. The service worker never caches this
 * page (public/sw.js), so it can't be shown to the next person using the device.
 */
export default async function AccountPage() {
  if (!isAdminConfigured()) return <AccountSetupRequired />;

  const user = await verifySessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login?next=/account");

  let profile = null;
  try {
    profile = await getProfile(user.uid);
  } catch {
    profile = null;
  }

  return (
    <AccountView
      key={profile?.uid ?? user.uid} // a different account never inherits the previous one's page state
      initialProfile={
        profile ?? {
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          displayName: null,
          createdAt: null,
          providers: [],
          verifiedByGoogle: false,
          passwordRemovedAt: null,
        }
      }
      profileLoadFailed={profile === null}
    />
  );
}
