/**
 * 上下文菜单（ARCHITECTURE §8.3）。
 *
 * 菜单内容不手写，由命令表按上下文过滤生成：同一条命令在文件树、编辑区、
 * 预览区各自出现的形态，差别只在 `when`，不在渲染代码。
 */

import { commandsFor, runCommand, type CommandArg, type CommandContext } from './registry';
import { bindingLabel } from './keys';

export interface ContextMenuOptions {
  x: number;
  y: number;
  ctx: CommandContext;
  arg?: CommandArg;
  /** 没有可用命令时的占位文案 */
  emptyText?: string;
}

let current: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

export function closeContextMenu(): void {
  current?.remove();
  current = null;
  cleanup?.();
  cleanup = null;
}

export function openContextMenu(opts: ContextMenuOptions): void {
  closeContextMenu();

  const items = commandsFor(opts.ctx, opts.arg);
  const menu = document.createElement('div');
  menu.className = 'ctxmenu';
  menu.setAttribute('role', 'menu');

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ctxmenu__empty';
    empty.textContent = opts.emptyText ?? '没有可用命令';
    menu.appendChild(empty);
  } else {
    let lastGroup: string | undefined;
    for (const def of items) {
      if (lastGroup !== undefined && def.group !== lastGroup) {
        const sep = document.createElement('div');
        sep.className = 'ctxmenu__sep';
        menu.appendChild(sep);
      }
      lastGroup = def.group;

      const label = bindingLabel(def.id);
      const btn = document.createElement('button');
      btn.className = 'ctxmenu__i';
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = `<span class="ctxmenu__t"></span><span class="ctxmenu__k"></span>`;
      btn.querySelector('.ctxmenu__t')!.textContent = def.title;
      btn.querySelector('.ctxmenu__k')!.textContent = label;
      btn.addEventListener('click', () => {
        closeContextMenu();
        void runCommand(def.id, opts.arg, opts.ctx);
      });
      menu.appendChild(btn);
    }
  }

  // 先挂到 body 再量尺寸，否则拿不到 offsetWidth
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  place(menu, opts.x, opts.y);
  menu.style.visibility = '';

  current = menu;

  const onPointerDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) closeContextMenu();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeContextMenu();
    }
  };
  const onScroll = () => closeContextMenu();
  // 延迟一拍再挂：触发菜单的那次右键/点击还在冒泡，立刻监听会把自己关掉
  const timer = window.setTimeout(() => {
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
  }, 0);

  cleanup = () => {
    window.clearTimeout(timer);
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
  };
}

/** 贴边纠偏：右下角放不下就往回收，不能出现「菜单被窗口裁掉一半」 */
function place(menu: HTMLElement, x: number, y: number): void {
  const margin = 6;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const maxX = window.innerWidth - w - margin;
  const maxY = window.innerHeight - h - margin;
  menu.style.left = `${Math.max(margin, Math.min(x, maxX))}px`;
  menu.style.top = `${Math.max(margin, Math.min(y, maxY))}px`;
}
