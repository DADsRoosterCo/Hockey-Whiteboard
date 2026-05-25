"use client";

const NAV_LINKS = [
  "HOME",
  "CALENDAR",
  "PRACTICE",
  "DRILLS",
  "COACHES",
  "SHOWCASES",
  "ASSIGNMENTS",
  "DOCUMENTS",
  "VIDEO",
  "PROFILE",
  "RAIL",
];

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-header__brand">
          <div className="app-header__logo">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="36" height="36" rx="8" fill="#0a1628" />
              <path d="M18 5L30 10V20C30 27 24 31 18 33C12 31 6 27 6 20V10L18 5Z" fill="#1a3a6e" stroke="#3b6fc4" strokeWidth="1.3" />
              <text x="18" y="23" textAnchor="middle" fill="#e2e8f0" fontSize="8.5" fontWeight="800" fontFamily="monospace">CCK</text>
            </svg>
          </div>
          <div className="app-header__brand-text">
            <span className="app-header__club">CCK2015</span>
            <span className="app-header__title">TEAM OPERATIONS</span>
          </div>
        </div>

        <nav className="app-header__nav" aria-label="Main navigation">
          {NAV_LINKS.map((link) => (
            <a
              key={link}
              href="#"
              className={`app-header__link${link === "DRILLS" ? " app-header__link--active" : ""}`}
            >
              {link}
            </a>
          ))}
        </nav>

        <div className="app-header__user">
          <div className="app-header__avatar" aria-label="User menu">N</div>
        </div>
      </div>
    </header>
  );
}
