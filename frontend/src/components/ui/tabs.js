// Keyboard behaviour for a row of tabs (completion C2), as in the WAI-ARIA
// tabs pattern: only the selected tab is in the Tab order; Left/Right move
// between tabs (wrapping), Home/End jump to the first/last, and the moved-to
// tab is selected. Each tab and its panel are linked by id.
export function tabProps(prefix, keys, active, setActive) {
  const select = (index) => {
    const key = keys[(index + keys.length) % keys.length];
    setActive(key);
    requestAnimationFrame(() => document.getElementById(`${prefix}-tab-${key}`)?.focus());
  };
  const onKeyDown = (e) => {
    const i = keys.indexOf(active);
    const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: keys.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(moves[e.key]);
  };
  return {
    list: { role: 'tablist', onKeyDown },
    tab: (key) => ({
      id: `${prefix}-tab-${key}`, role: 'tab', 'aria-selected': active === key, 'aria-controls': `${prefix}-panel-${key}`,
      tabIndex: active === key ? 0 : -1, onClick: () => setActive(key),
    }),
    panel: (key) => ({ id: `${prefix}-panel-${key}`, role: 'tabpanel', 'aria-labelledby': `${prefix}-tab-${key}`, tabIndex: 0 }),
  };
}
