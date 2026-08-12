import { CircleCheck, CircleX, X } from 'lucide-react'

export interface ToastState { type: 'success' | 'error'; message: string }

export default function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null
  return (
    <div className={`toast ${toast.type}`} role="status">
      {toast.type === 'success' ? <CircleCheck /> : <CircleX />}
      <span>{toast.message}</span>
      <button aria-label="Yopish" onClick={onClose}><X size={16} /></button>
    </div>
  )
}

