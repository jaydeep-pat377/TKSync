export type ToastType = 'error' | 'success' | 'warning' | 'info';

export type ToastItem = {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  duration: number;
};

type ToastListener = (toasts: ToastItem[]) => void;

let _id = 0;
let _queue: ToastItem[] = [];
const _listeners = new Set<ToastListener>();

function emit() {
  const snapshot = [..._queue];
  _listeners.forEach(cb => cb(snapshot));
}

export function showToast(
  type: ToastType,
  title: string,
  message?: string,
  duration = 4000,
) {
  const item: ToastItem = {id: ++_id, type, title, message, duration};
  _queue = [..._queue, item];
  emit();

  setTimeout(() => {
    dismissToast(item.id);
  }, duration);
}

export function dismissToast(id: number) {
  const before = _queue.length;
  _queue = _queue.filter(t => t.id !== id);
  if (_queue.length !== before) emit();
}

export function onToastChange(cb: ToastListener): () => void {
  _listeners.add(cb);
  cb([..._queue]);
  return () => {
    _listeners.delete(cb);
  };
}
