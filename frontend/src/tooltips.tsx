import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
type Tip = {
  text: string;
  leaving?: boolean;
  left: number;
  top: number;
  below: boolean;
  container: Element;
};
/** One delegated tooltip layer also covers controls rendered in native dialogs. */
export function Tooltips() {
  const id = useId(),
    [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined,
      removal: ReturnType<typeof setTimeout> | undefined,
      target: HTMLElement | null = null;
    const detach = () => {
      clearTimeout(timer);
      clearTimeout(removal);
      if (target) {
        const ids = (target.getAttribute("aria-describedby") || "")
          .split(" ")
          .filter((x) => x && x !== id);
        if (ids.length) target.setAttribute("aria-describedby", ids.join(" "));
        else target.removeAttribute("aria-describedby");
      }
      target = null;
    };
    const clear = () => {
      detach();
      setTip(null);
    };
    const hide = () => {
      detach();
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setTip(null);
        return;
      }
      setTip((current) => (current ? { ...current, leaving: true } : null));
      removal = setTimeout(() => setTip(null), 140);
    };
    const show = (el: HTMLElement, delay: number) => {
      if (target === el) return;
      clear();
      target = el;
      timer = setTimeout(() => {
        if (!el.isConnected) return clear();
        const text = el.dataset.tooltip;
        if (!text) return;
        const r = el.getBoundingClientRect(),
          dialog = el.closest("dialog"),
          bounds = dialog?.getBoundingClientRect();
        const leftEdge = Math.max(8, bounds?.left || 0),
          rightEdge = Math.min(innerWidth - 8, bounds?.right || innerWidth),
          below = r.top < (bounds?.top || 0) + 48;
        const described = el.getAttribute("aria-describedby");
        el.setAttribute(
          "aria-describedby",
          [described, id].filter(Boolean).join(" "),
        );
        setTip({
          text,
          left: Math.max(
            leftEdge + Math.min(120, (rightEdge - leftEdge) / 2),
            Math.min(rightEdge - 120, r.left + r.width / 2),
          ),
          top: below ? r.bottom + 8 : r.top - 8,
          below,
          container: dialog || document.body,
        });
      }, delay);
    };
    const enter = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element).closest<HTMLElement>("[data-tooltip]");
      if (el) show(el, 350);
    };
    const leave = (e: PointerEvent) => {
      if (
        target &&
        !(e.relatedTarget instanceof Node && target.contains(e.relatedTarget))
      )
        hide();
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as Element).closest<HTMLElement>("[data-tooltip]");
      if (el) show(el, 0);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", clear);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      clear();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", clear);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [id]);
  return tip
    ? createPortal(
        <div
          id={tip.leaving ? undefined : id}
          role={tip.leaving ? undefined : "tooltip"}
          aria-hidden={tip.leaving || undefined}
          className={
            "app-tooltip " +
            (tip.below ? "tooltip-below " : "") +
            (tip.leaving ? "tooltip-leaving" : "")
          }
          style={{ left: tip.left, top: tip.top }}
        >
          {tip.text}
        </div>,
        tip.container,
      )
    : null;
}
