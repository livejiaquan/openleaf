let activeToast: HTMLDivElement | null = null;
let activeToastTimer: number | null = null;

export function showToast(message: string, duration = 2000): void {
  if (typeof document === 'undefined') return;

  if (activeToastTimer !== null) {
    window.clearTimeout(activeToastTimer);
    activeToastTimer = null;
  }

  activeToast?.remove();

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.className = [
    'fixed',
    'bottom-4',
    'right-4',
    'z-50',
    'max-w-[calc(100vw-2rem)]',
    'rounded',
    'bg-white',
    'px-4',
    'py-2',
    'text-sm',
    'font-medium',
    'text-gray-900',
    'shadow-lg',
    'dark:bg-[#25272b]',
    'dark:text-white',
  ].join(' ');

  document.body.appendChild(toast);
  activeToast = toast;

  activeToastTimer = window.setTimeout(() => {
    toast.remove();
    if (activeToast === toast) activeToast = null;
    activeToastTimer = null;
  }, duration);
}

export function ToastContainer(): null {
  return null;
}
