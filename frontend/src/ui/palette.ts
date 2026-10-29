/**
 * 命令面板 UI（ARCHITECTURE §8.2）。
 *
 * 面板不再自己维护命令列表：条目来自命令表，键位提示来自键位表。
 * 以前这里是 `hint: 'Ctrl N'` 这样的字面量，改键后提示不跟着变。
 */

import { bindingLabel } from '../commands/keys';
import { allCommands, runCommand, type CommandDef } from '../commands/registry';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let filtered: CommandDef[] = [];
let cursor = 0;

export function openPalette(): void {
  const box = $('palette');
  box.hidden = false;
  const input = $('paletteInput') as HTMLInputElement;
  input.value = '';
  filtered = allCommands();
  cursor = 0;
  render();
  input.focus();
}

export function closePalette(): void {
  $('palette').hidden = true;
}

export function isPaletteOpen(): boolean {
  return !$('palette').hidden;
}

function render(): void {
  const list = $('paletteList');
  list.innerHTML = '';
  filtered.forEach((cmd, i) => {
    const item = document.createElement('div');
    const label = bindingLabel(cmd.id);
    item.className = `pitem${i === cursor ? ' is-on' : ''}`;
    const title = document.createElement('span');
    title.textContent = cmd.title;
    item.appendChild(title);
    if (label) {
      const key = document.createElement('span');
      key.className = 'pitem__k';
      key.textContent = label;
      item.appendChild(key);
    }
    item.addEventListener('click', () => exec(cmd));
    item.addEventListener('mousemove', () => {
      if (cursor !== i) {
        cursor = i;
        render();
      }
    });
    list.appendChild(item);
  });
  if (filtered.length === 0) {
    list.innerHTML = '<div class="pitem">没有匹配的命令</div>';
  }
}

function exec(cmd: CommandDef): void {
  closePalette();
  void runCommand(cmd.id);
}

export function mountPalette(): void {
  const input = $('paletteInput') as HTMLInputElement;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    filtered = allCommands().filter((c) => {
      const key = bindingLabel(c.id).toLowerCase();
      return `${c.title} ${c.id} ${key}`.toLowerCase().includes(q);
    });
    cursor = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      cursor = Math.min(cursor + 1, filtered.length - 1);
      render();
      e.preventDefault();
    }
    if (e.key === 'ArrowUp') {
      cursor = Math.max(cursor - 1, 0);
      render();
      e.preventDefault();
    }
    if (e.key === 'Enter' && filtered[cursor]) exec(filtered[cursor]);
  });
  document.querySelector('[data-close="palette"]')?.addEventListener('click', closePalette);
}
