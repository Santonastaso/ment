import { createPortal } from 'react-dom';

export default function Portal({ children }) {
  return typeof document === 'undefined' ? children : createPortal(children, document.body);
}
