import { ReactNode, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { expandApp, readyApp, showBackButton, hideBackButton } from '../lib/telegram';

interface LayoutProps {
  children: ReactNode;
  showHeader?: boolean;
  showBottomNav?: boolean;
}

export const Layout = ({ children, showHeader = true, showBottomNav = true }: LayoutProps) => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    expandApp();
    readyApp();
  }, []);

  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/home') {
      hideBackButton();
    } else {
      showBackButton(() => navigate(-1));
    }

    return () => {
      hideBackButton();
    };
  }, [location, navigate]);

  /**
   * Flag the on-screen keyboard so bottom-anchored bars can get out of its way.
   *
   * This used to be `visualViewport.height < innerHeight * 0.75` alone, which
   * asks the wrong question. A 25% threshold is not a property of keyboards: in
   * landscape the keyboard covers well over a quarter of the screen and the rule
   * fires with nothing focused, while a compact or floating keyboard (or an
   * Android browser that resizes nothing at all) never trips it. The condition
   * also ran only inside Telegram, so the same layout misbehaved differently in
   * a normal browser.
   *
   * What actually matters is whether the user is typing, and the DOM answers
   * that directly: an editable element has focus. The viewport measurement is
   * kept as a secondary trigger — with a far more conservative threshold — so a
   * platform that shrinks the viewport without moving focus is still handled.
   */
  useEffect(() => {
    const isEditable = (node: Element | null): boolean => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.isContentEditable) return true;
      const tag = node.tagName;
      if (tag === 'TEXTAREA') return true;
      if (tag !== 'INPUT') return false;
      // Checkboxes, radios and buttons are inputs but summon no keyboard.
      const type = (node as HTMLInputElement).type;
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
    };

    const vp = window.visualViewport;
    // Focus only implies a keyboard on a touch device. A mouse-driven browser
    // shows no keyboard, so hiding the navigation there would be a regression
    // the old `isTelegramWebApp()` guard happened to prevent.
    const coarsePointer = window.matchMedia('(pointer: coarse)');

    const update = () => {
      const typing = isEditable(document.activeElement) && coarsePointer.matches;
      // Half the viewport is unambiguous; a quarter is not.
      const shrunk = vp ? vp.height < window.innerHeight * 0.5 : false;
      document.body.classList.toggle('keyboard-open', typing || shrunk);
    };

    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    vp?.addEventListener('resize', update);
    vp?.addEventListener('scroll', update);
    update();

    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      vp?.removeEventListener('resize', update);
      vp?.removeEventListener('scroll', update);
      document.body.classList.remove('keyboard-open');
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {showHeader && <Header />}

      <main
        className="flex-1 layout-main"
        style={showBottomNav
          // The floating bar's height, the gap under it, and a little breathing
          // room so the last row is not flush against the glass.
          ? { paddingBottom: 'calc(var(--bottom-nav-height) + var(--bottom-nav-gap) + 0.75rem + env(safe-area-inset-bottom, 0px))' }
          : undefined}
      >
        {children}
      </main>

      {showBottomNav && <BottomNav />}
    </div>
  );
};
