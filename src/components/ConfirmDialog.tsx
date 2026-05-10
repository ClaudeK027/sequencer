import { Modal } from './Modal';
import { Icon, type IconName } from './Icon';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  icon?: IconName;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  variant = 'primary',
  icon,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <div className="confirm-body">
        {icon && (
          <div className={`confirm-icon variant-${variant}`}>
            <Icon name={icon} size={20} />
          </div>
        )}
        <p className="confirm-message">{message}</p>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>{cancelLabel}</button>
        <button
          className={variant === 'danger' ? 'btn danger-action' : 'btn primary'}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
