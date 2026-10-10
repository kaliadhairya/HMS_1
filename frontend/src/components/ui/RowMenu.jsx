import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';

// "More actions" menu for a table row. items: [{ label, icon, onSelect, danger, separator, hidden }]
export default function RowMenu({ label, items }) {
  const visible = items.filter((i) => i && !i.hidden);
  if (visible.length === 0) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="icon-btn row-action" aria-label={label} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={4} onClick={(e) => e.stopPropagation()}>
          {visible.map((item, i) => {
            const Icon = item.icon;
            return (
              <span key={item.label} style={{ display: 'contents' }}>
                {item.separator && i > 0 && <DropdownMenu.Separator className="menu-sep" />}
                <DropdownMenu.Item className={`menu-item${item.danger ? ' is-danger' : ''}`} onSelect={item.onSelect}>
                  {Icon && <Icon size={16} aria-hidden="true" />} {item.label}
                </DropdownMenu.Item>
              </span>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
