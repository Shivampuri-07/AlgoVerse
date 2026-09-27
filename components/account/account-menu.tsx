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

/** Top-bar account entry: "Sign in" when signed out, an avatar menu when signed in. */
export function AccountMenu() {
  const { status, user, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (status === "unavailable") return null;
  if (status === "loading") {
    return <div className="h-9 w-9 animate-pulse rounded-full bg-muted" aria-hidden />;
  }
  if (status === "signed-out" || !user) {
    const next = AUTH_PAGES.includes(pathname) ? "" : `?next=${encodeURIComponent(pathname)}`;
    return (
      <Button asChild variant="outline" size="sm" className="h-9">
        <Link href={`/login${next}`}>
          <LogIn className="h-4 w-4" />
          <span className="hidden sm:inline">Sign in</span>
        </Link>
      </Button>
    );
  }

  async function handleSignOut() {
    try {
      await signOut();
      toast.success("Signed out. Your progress on this device is unchanged.");
      if (pathname.startsWith("/account")) router.replace("/");
    } catch {
      toast.error("Couldn't sign out. Check your connection and try again.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
        >
          {initialOf(user.displayName, user.email)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          {user.displayName && <p className="truncate text-sm font-medium">{user.displayName}</p>}
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
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
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
