// Every icon in the app: inline 24×24 stroke SVGs drawn in currentColor (docs/plans/ui-rework.md rule 5).
// No icon library. Icons are decorative (aria-hidden): an icon-only button names itself with aria-label.

import type { ReactNode } from "react";

type IconProps = { className?: string };

function Icon({ className = "size-5", children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

const icon = (paths: ReactNode) => (props: IconProps) => <Icon {...props}>{paths}</Icon>;

// Navigation
export const HomeIcon = icon(<path d="M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" />);
export const CollectionsIcon = icon(
  <>
    <rect x="3" y="7" width="13" height="14" rx="2" />
    <path d="M7 3h12a2 2 0 0 1 2 2v12" />
  </>,
);
export const RequestsIcon = icon(<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />);
export const OverlaysIcon = icon(
  <>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <rect x="12" y="6" width="5" height="4" rx="1" />
  </>,
);
export const PlaylistsIcon = icon(<path d="M4 6h12M4 12h12M4 18h7m5-2v-5l5 2.5-5 2.5Z" />);
export const ActivityIcon = icon(<path d="M3 12h4l3-8 4 16 3-8h4" />);
export const SystemIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </>,
);
export const SettingsIcon = icon(
  <>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </>,
);

// Actions
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </>,
);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const UploadIcon = icon(<path d="M12 15V3m0 0L8 7m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />);
export const CheckIcon = icon(<path d="m5 12 5 5 9-10" />);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />);
export const ChevronUpIcon = icon(<path d="m6 15 6-6 6 6" />);
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);

// Layers (overlay studio)
export const EyeIcon = icon(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const EyeOffIcon = icon(<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />);
export const LockIcon = icon(
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
);
export const GripIcon = icon(<path d="M9 6h0M15 6h0M9 12h0M15 12h0M9 18h0M15 18h0" strokeWidth={3} />);
