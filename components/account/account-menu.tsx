"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

function initialOf(name: string | null, email: string | null): string {
  const source = (name || email || "?").trim();
  return source.charAt(0).toUpperCase();
}

/**
 * Top-bar account entry. Signed out — and also when accounts aren't configured on this
 * deployment — it shows "Log in" and "Sign up" (the pages then explain any setup problem).
 * Signed in, it shows an avatar menu with the email, Account and Log out.
 */
export function AccountMenu() {
  const { status, user, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (status === "loading") {
    return <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" aria-hidden />;
  }

  if (status !== "signed-in" || !user) {
    const next = AUTH_PAGES.includes(pathname) || pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return (
      <div className="flex items-center gap-1.5">
        <Button asChild variant="ghost" size="sm" className="h-9 px-2.5 sm:px-3">
          <Link href={`/login${next}`} aria-label="Log in">
            <LogIn className="h-4 w-4" />
            <span className="hidden sm:inline">Log in</span>
          </Link>
        </Button>
        <Button asChild size="sm" className="h-9 px-3">
          <Link href={`/signup${next}`}>Sign up</Link>
        </Button>
      </div>
    );
  }

  async function handleSignOut() {
    try {
      await signOut();
      toast.success("Logged out. Your progress on this device is unchanged.");
      if (pathname.startsWith("/account")) router.replace("/");
    } catch {
      toast.error("Couldn't log out. Check your connection and try again.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Account menu for ${user.email ?? "your account"}`}
        >
          {initialOf(user.displayName, user.email)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          {user.displayName && <p className="truncate text-sm font-medium">{user.displayName}</p>}
          <p className="truncate text-sm" data-testid="account-email">
            {user.email}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound className="h-4 w-4" />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut className="h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
