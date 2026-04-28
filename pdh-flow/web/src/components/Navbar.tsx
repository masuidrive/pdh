type Props = {
  ticketId?: string | null;
  ticketTitle?: string | null;
  branch?: string;
  collapsed: boolean;
  onToggle: () => void;
};

export function Navbar({ ticketId, ticketTitle, branch, collapsed, onToggle }: Props) {
  return (
    <div className="navbar sticky top-0 z-30 border-b border-base-300 bg-base-100">
      <div className="navbar-start gap-3">
        <button
          className="btn btn-ghost btn-square btn-sm"
          aria-label={collapsed ? "タイムラインを開く" : "タイムラインを折りたたむ"}
          aria-expanded={!collapsed}
          onClick={onToggle}
          type="button"
        >
          <span className="text-xl">{collapsed ? "›" : "☰"}</span>
        </button>
        <div className="avatar avatar-placeholder">
          <div className="w-9 rounded-box bg-neutral text-neutral-content">
            <span className="text-xs font-bold">PD</span>
          </div>
        </div>
        <div>
          <p className="text-base font-bold leading-tight">PDH Dev</p>
          <div className="breadcrumbs hidden p-0 text-xs sm:block">
            <ul>
              {branch ? <li>{branch}</li> : null}
              {ticketId ? <li>{ticketId}</li> : null}
            </ul>
          </div>
        </div>
      </div>
      <div className="navbar-end gap-2">
        {ticketTitle ? <span className="hidden text-sm text-base-content/60 lg:inline">{ticketTitle}</span> : null}
      </div>
    </div>
  );
}
