'use client';

/**
 * What the signed-in account may open, handed down from the layout to the
 * rail's links, the tab bar and the צפייה בלבד banner — the three client
 * islands that decide what to draw from it. It is display, never
 * enforcement: every page and every action calls `requireAdmin` on its own
 * (`src/lib/auth/guard.ts`), and a link this hides is still refused when
 * typed into the address bar.
 *
 * With no provider above it — a test rendering one island on its own —
 * everything reads as open. The islands exist to show what a page allows,
 * and a test of the rail's shape should not have to describe an account
 * first; the layout always mounts the provider, so the app itself never
 * takes this path.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  levelOf as levelFor, type AccessLevel, type AccessMap, type PageKey,
} from '@/lib/auth/pages';
import { pageOfItem, type NavItem } from './nav-data';

export interface AccessView {
  admin: boolean;
  /** How far the account may go on this page; `null` is closed. */
  levelOf: (page: PageKey) => AccessLevel | null;
  /** Whether the rail should offer this item at all. */
  visible: (item: NavItem) => boolean;
}

const EVERYTHING: AccessView = {
  admin: true,
  levelOf: () => 'edit',
  visible: () => true,
};

const AccessContext = createContext<AccessView>(EVERYTHING);

export function AccessProvider({ admin, pages, children }: {
  admin: boolean;
  pages: AccessMap;
  children: ReactNode;
}) {
  const value = useMemo<AccessView>(() => {
    const grants = { admin, pages };
    const levelOf = (page: PageKey) => levelFor(grants, page);
    return {
      admin,
      levelOf,
      visible: (item) => {
        if (item.adminOnly) return admin;
        const page = pageOfItem(item);
        return page !== null && levelOf(page) !== null;
      },
    };
  }, [admin, pages]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessView {
  return useContext(AccessContext);
}
