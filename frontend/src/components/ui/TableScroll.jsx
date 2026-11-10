// A labelled, keyboard-scrollable region keeps clinical table columns readable on small screens.
export default function TableScroll({ label, children }) {
  return <div className="table-scroll-wrap"><p className="table-scroll-hint">Scroll horizontally to see all columns.</p><div className="table-scroll" role="region" aria-label={label} tabIndex={0}>{children}</div></div>;
}
