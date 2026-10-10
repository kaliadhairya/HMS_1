// Standard page title block: title, one-line description and page-level actions.
export default function PageHeader({ title, description, actions, meta }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {meta && <div className="page-head-meta">{meta}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}
