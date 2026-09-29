import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PortalProps {
  children: ReactNode;
  container?: Element;
}

export const Portal = ({ children, container }: PortalProps) => {
  const defaultRef = useRef<HTMLDivElement | null>(null);
  const [mountNode, setMountNode] = useState<Element | null>(null);

  useEffect(() => {
    if (container) {
      setMountNode(container);
      return;
    }
    const node = document.createElement('div');
    node.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(node);
    defaultRef.current = node;
    setMountNode(node);
    return () => {
      if (defaultRef.current) {
        document.body.removeChild(defaultRef.current);
      }
    };
  }, [container]);

  if (!mountNode) return null;
  return createPortal(children, mountNode);
};
