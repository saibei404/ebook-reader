interface IconProps {
  size?: number
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

export const IconLibrary = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
)

export const IconSliders = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <circle cx="9" cy="6" r="2.2" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <circle cx="15" cy="12" r="2.2" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="7" cy="18" r="2.2" />
  </svg>
)

export const IconSearch = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
)

export const IconPlus = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const IconImage = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.8" />
    <path d="M4 18l5-5 4 4 3-3 4 4" />
  </svg>
)

export const IconSun = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </svg>
)

export const IconMoon = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
)

export const IconMinus = ({ size = 14 }: IconProps) => (
  <svg {...svgProps(size)}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const IconSquare = ({ size = 12 }: IconProps) => (
  <svg {...svgProps(size)}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
)

export const IconX = ({ size = 14 }: IconProps) => (
  <svg {...svgProps(size)}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
)

export const IconTrash = ({ size = 15 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </svg>
)

export const IconRefresh = ({ size = 15 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v4h-4" />
  </svg>
)

export const IconShuffle = ({ size = 15 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
)

export const IconMonitor = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
    <path d="M10 8.5l4 2.5-4 2.5z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconChevron = ({ size = 14 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
)

export const IconKeyboard = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
  </svg>
)

export const IconDatabase = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6M4 11.5v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
  </svg>
)

export const IconInfo = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
)

export const IconCheck = ({ size = 14 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
)

export const IconBook = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
    <path d="M4 20.5V5.5" />
  </svg>
)

export const IconCompass = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </svg>
)

export const IconNote = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M5 4h14v16H5z" />
    <path d="M9 9h6M9 13h6M9 17h3" />
  </svg>
)

export const IconUser = ({ size = 18 }: IconProps) => (
  <svg {...svgProps(size)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </svg>
)

export const IconBookmark = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M6 3.5h12v17l-6-4-6 4z" />
  </svg>
)

export const IconCloud = ({ size = 16 }: IconProps) => (
  <svg {...svgProps(size)}>
    <path d="M6.5 18.5h11a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.2 9.6 4.5 4.5 0 0 0 6.5 18.5z" />
    <path d="M12 12v5M9.5 14.5L12 12l2.5 2.5" />
  </svg>
)
