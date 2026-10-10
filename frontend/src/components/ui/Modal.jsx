import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

// Accessible dialog: focus trap, Esc to close, labelled by its title.
export default function Modal({ open, onOpenChange, title, description, size = 'md', footer, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog-content dialog-${size}`}>
          <div className="dialog-head">
            <div>
              <Dialog.Title className="dialog-title">{title}</Dialog.Title>
              {description
                ? <Dialog.Description className="dialog-description">{description}</Dialog.Description>
                : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-btn" aria-label="Close"><X size={18} /></button>
            </Dialog.Close>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
