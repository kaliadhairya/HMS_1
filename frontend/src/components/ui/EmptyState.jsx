// Shown when a list has nothing to display; always offers a next step when there is one.
export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="empty-state">
      {Icon && <span className="empty-state-icon"><Icon size={22} strokeWidth={1.75} aria-hidden="true" /></span>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
