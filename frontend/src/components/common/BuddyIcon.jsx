import { createContext, useContext, useEffect, useMemo, useState } from "react";
import classicLogo from "@/assets/english-buddy-logo.svg";
import catLogo from "@/assets/english-buddy-logo-cat.png";

const BUDDY_ICON_STORAGE_KEY = "englishBuddy.buddyIcon";

export const BUDDY_ICON_OPTIONS = [
  {
    id: "cat",
    label: "고양이 Buddy",
    shortLabel: "고양이",
    description: "기본 English Buddy 아이콘",
    src: catLogo,
  },
  {
    id: "classic",
    label: "클래식 로고",
    shortLabel: "클래식",
    description: "초기 English Buddy 로고",
    src: classicLogo,
  },
];

const BUDDY_ICONS = Object.fromEntries(
  BUDDY_ICON_OPTIONS.map((option) => [option.id, option])
);

const BuddyIconContext = createContext(null);

export function normalizeBuddyIcon(value) {
  return value === "classic" ? "classic" : "cat";
}

function readStoredBuddyIcon() {
  if (typeof window === "undefined") return "cat";
  try {
    return normalizeBuddyIcon(window.localStorage.getItem(BUDDY_ICON_STORAGE_KEY));
  } catch {
    return "cat";
  }
}

function writeStoredBuddyIcon(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BUDDY_ICON_STORAGE_KEY, normalizeBuddyIcon(value));
  } catch {
    // Local persistence is optional; account persistence remains the source of truth.
  }
}

export function BuddyIconProvider({ user, children }) {
  const [localIcon, setLocalIcon] = useState(readStoredBuddyIcon);
  const accountIcon = user?.buddy_icon ? normalizeBuddyIcon(user.buddy_icon) : null;
  const buddyIcon = accountIcon || localIcon;

  useEffect(() => {
    if (!accountIcon) return;
    setLocalIcon(accountIcon);
    writeStoredBuddyIcon(accountIcon);
  }, [accountIcon]);

  const value = useMemo(
    () => ({
      buddyIcon,
      icon: BUDDY_ICONS[buddyIcon] || BUDDY_ICONS.classic,
      options: BUDDY_ICON_OPTIONS,
      setBuddyIconPreference: (nextIcon) => {
        const cleanIcon = normalizeBuddyIcon(nextIcon);
        setLocalIcon(cleanIcon);
        writeStoredBuddyIcon(cleanIcon);
        return cleanIcon;
      },
    }),
    [buddyIcon]
  );

  return (
    <BuddyIconContext.Provider value={value}>
      {children}
    </BuddyIconContext.Provider>
  );
}

export function useBuddyIcon() {
  return useContext(BuddyIconContext) || {
    buddyIcon: "cat",
    icon: BUDDY_ICONS.cat,
    options: BUDDY_ICON_OPTIONS,
    setBuddyIconPreference: () => "cat",
  };
}

export function BuddyLogo({
  icon,
  className = "",
  decorative = true,
  alt = "English Buddy",
  ...props
}) {
  const context = useBuddyIcon();
  const selected = BUDDY_ICONS[normalizeBuddyIcon(icon || context.buddyIcon)] || BUDDY_ICONS.cat;

  return (
    <img
      src={selected.src}
      alt={decorative ? "" : alt}
      aria-hidden={decorative ? "true" : undefined}
      className={className}
      draggable="false"
      {...props}
    />
  );
}
