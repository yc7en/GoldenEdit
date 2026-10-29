/**
 * 键盘快捷方式弹窗（ARCHITECTURE §8.4）。
 *
 * 形态对齐 VS Code：四列「命令 / 键绑定 / 当 / 源」。点键绑定进入录制态，
 * 按 Esc 取消、Backspace 解绑、Delete 恢复默认。
 */

import { escapeHtml, openModal, toast } from '../ui/shell';
import { store } from '../store';
import { allCommands, contextsOf, getCommand, type CommandDef } from './registry';
import {
  bindingText,
  chordOf,
  conflictsFor,
  formatChord,
  parseChord,
  setBinding,
  setLetThrough,
} from './keys';

let recordingId: string | null = null;
let filter = '';

export function openKeysDialog(): void {
  recordingId = null;
  filter = '';
  const card = openModal(`
    <div class="modal__title">键盘快捷方式</div>
    <div class="modal__sub">点「键绑定」开始录制：按下组合键即绑定，Esc 取消，Backspace 解绑，Delete 恢复默认。标注「原生」的项由编辑器自己处理，不可改。</div>
    <input class="input keys__search" id="keysSearch" placeholder="搜索命令、键位或来源…" />
    <div class="keys__table">
      <div class="keys__head">
        <span>命令</span><span>键绑定</span><span>当</span><span>源</span>
      </div>
      <div class="keys__list" id="keysList"></div>
    </div>
    <div class="modal__foot">
      <span class="grow"></span>
      <button class="btn" data-close="modal">关闭</button>
    </div>
  `);
  card.classList.add('modal__card--wide');

  const search = card.querySelector<HTMLInputElement>('#keysSearch')!;
  search.addEventListener('input', () => {
    filter = search.value.trim().toLowerCase();
    renderList();
  });

  const list = card.querySelector<HTMLElement>('#keysList')!;
  list.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.keys__row') as HTMLElement | null;
    if (!row?.dataset.id) return;
    // native 命令的键位在 Monaco 手里，改了也不会生效；直接说清楚，别让用户白录一遍
    if (getCommand(row.dataset.id)?.native) {
      toast('这一项由编辑器原生处理，不归快捷键系统管', 'err');
      return;
    }
    startRecording(row.dataset.id);
  });

  renderList();

  // 关闭弹窗要把录制态一起收掉，否则下一次按键还在「录」
  card.querySelectorAll('[data-close="modal"]').forEach((el) =>
    el.addEventListener('click', () => {
      recordingId = null;
      setLetThrough(false);
    })
  );

  search.focus();
}

function rows(): CommandDef[] {
  const all = allCommands();
  if (!filter) return all;
  return all.filter((def) => {
    const label = bindingText(def.id) ?? '';
    const hay = `${def.title} ${def.id} ${label} ${def.source ?? 'system'}`.toLowerCase();
    return hay.includes(filter);
  });
}

function renderList(): void {
  const list = document.getElementById('keysList');
  if (!list) return;
  list.innerHTML = '';
  const items = rows();
  if (items.length === 0) {
    list.innerHTML = '<div class="keys__empty">没有匹配的命令</div>';
    return;
  }
  for (const def of items) {
    const isRec = def.id === recordingId;
    const label = bindingText(def.id);
    const chord = label ? formatChord(parseChord(label)!) : '';
    const keyCell = isRec
      ? '按下组合键…'
      : def.native
        ? `${chord ? `<kbd>${escapeHtml(chord)}</kbd>` : ''}<span class="keys__native">原生</span>`
        : chord
          ? `<kbd>${escapeHtml(chord)}</kbd>`
          : '<span class="keys__none">未绑定</span>';
    const row = document.createElement('div');
    row.className = `keys__row${isRec ? ' is-recording' : ''}${def.native ? ' is-locked' : ''}`;
    row.dataset.id = def.id;
    row.innerHTML = `
      <span class="keys__t">${escapeHtml(def.title)}</span>
      <span class="keys__k">${keyCell}</span>
      <span class="keys__w">${escapeHtml(contextsOf(def).join(', '))}</span>
      <span class="keys__s">${escapeHtml(def.source && def.source !== 'system' ? def.source : '系统')}</span>
    `;
    list.appendChild(row);
  }
}

function startRecording(id: string): void {
  recordingId = id;
  setLetThrough(true);
  renderList();
  // 录制监听挂在 document 捕获阶段，优先于 keys 的窗口监听
  const onKey = (e: KeyboardEvent) => {
    if (recordingId !== id) {
      document.removeEventListener('keydown', onKey, true);
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      stop();
      return;
    }
    if (e.key === 'Backspace') {
      void commit(id, null);
      return;
    }
    if (e.key === 'Delete') {
      void commit(id, undefined);
      return;
    }

    // 只按修饰键不算一个有效组合
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    void commit(id, formatChord(chordOf(e)));
  };
  const stop = () => {
    recordingId = null;
    setLetThrough(false);
    document.removeEventListener('keydown', onKey, true);
    renderList();
  };
  document.addEventListener('keydown', onKey, true);
}

async function commit(id: string, text: string | null | undefined): Promise<void> {
  recordingId = null;
  setLetThrough(false);
  const def = getCommand(id);
  if (!def) return;

  if (typeof text === 'string') {
    const chord = parseChord(text);
    if (!chord) {
      toast(`无法识别的键位：${text}`, 'err');
      renderList();
      return;
    }
    const clashes = conflictsFor(id, chord);
    if (clashes.length > 0) {
      const names = clashes.map((c) => `「${c.title}」`).join('、');
      if (!window.confirm(`${formatChord(chord)} 已被 ${names} 使用，是否覆盖？`)) {
        renderList();
        return;
      }
      // 覆盖：把原命令解绑，避免同一个键在相同上下文里有两份主语
      for (const c of clashes) await setBinding(c.id, null);
    }
  }

  await setBinding(id, text);
  renderList();
  store.pushLog('info', `快捷键已更新：${def.title}`);
}
