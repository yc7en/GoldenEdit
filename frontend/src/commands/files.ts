/**
 * 文件树命令（ARCHITECTURE §8.3）。
 *
 * 菜单项不再在 shell.ts 里手写数组——这里注册一次，右键菜单、快捷键、
 * 命令面板三处同时可用。
 */

import * as api from '../bridge';
import { bus, store } from '../store';
import { registerCommands, type CommandArg, type CommandDef } from './registry';

const fileTreeWhen: CommandDef['when'] = ['fileTree'];

/** 把文本写进系统剪贴板。WebView2 里 clipboard API 可能因权限失败，降级到 execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** 绝对路径用 Windows 分隔符，可直接粘进资源管理器地址栏 */
export function absolutePath(rel: string): string {
  const root = (store.vault?.root ?? '').replace(/[\\/]+$/, '');
  if (!rel) return root;
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root}${sep}${rel.replace(/\//g, sep)}`;
}

/** 右键目标：文件取其父目录，目录取自身，空白处取根 */
function targetDir(arg?: CommandArg): string {
  const rel = arg?.rel ?? '';
  if (!rel) return '';
  if (arg?.isFile) return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  return rel;
}

function parentOf(rel: string): string {
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
}

async function createFilePrompt(parent: string): Promise<void> {
  const name = window.prompt('新文件名（含扩展名）', 'untitled.md');
  if (!name) return;
  try {
    await store.createFile(name, parent);
  } catch (err) {
    bus.emit('toast', { text: `创建失败：${(err as Error).message}`, kind: 'err' });
  }
}

async function createFolderPrompt(parent: string): Promise<void> {
  const name = window.prompt('新文件夹名', 'notes');
  if (!name) return;
  const rel = parent ? `${parent}/${name}` : name;
  try {
    await api.createEntry(rel, 'dir');
    store.tree.delete(parent);
    await store.loadDir(parent);
  } catch (err) {
    bus.emit('toast', { text: `创建失败：${(err as Error).message}`, kind: 'err' });
  }
}

async function renamePrompt(rel: string): Promise<void> {
  const name = window.prompt('新名称', rel.split('/').pop() ?? rel);
  if (!name) return;
  const parent = parentOf(rel);
  const to = parent ? `${parent}/${name}` : name;
  try {
    await api.renameEntry(rel, to);
    store.tree.clear();
    await store.loadDir('');
    bus.emit('tree');
  } catch (err) {
    bus.emit('toast', { text: `重命名失败：${(err as Error).message}`, kind: 'err' });
  }
}

async function deletePrompt(rel: string): Promise<void> {
  if (!window.confirm(`确定删除 ${rel}？（移入回收站）`)) return;
  try {
    await store.deleteEntry(rel);
    bus.emit('toast', { text: '已移入回收站' });
  } catch (err) {
    bus.emit('toast', { text: `删除失败：${(err as Error).message}`, kind: 'err' });
  }
}

export function registerFileCommands(): void {
  const hasTarget = (arg?: CommandArg) => Boolean(arg?.rel);

  registerCommands([
    {
      id: 'file.new',
      title: '新建文档',
      group: '文件',
      when: ['global'],
      default: 'Ctrl+N',
      source: 'system',
      run: () => {
        if (!store.vault) {
          bus.emit('toast', { text: '先打开一个文件夹', kind: 'err' });
          return;
        }
        void createFilePrompt(parentOf(store.activeRel ?? ''));
      },
    },
    {
      id: 'file.copy',
      title: '复制',
      group: '剪贴板',
      when: fileTreeWhen,
      default: 'Ctrl+C',
      source: 'system',
      enabled: hasTarget,
      run: (arg) => {
        if (!arg?.rel) return;
        store.setFileClip('copy', [arg.rel]);
      },
    },
    {
      id: 'file.cut',
      title: '剪切',
      group: '剪贴板',
      when: fileTreeWhen,
      default: 'Ctrl+X',
      source: 'system',
      enabled: hasTarget,
      run: (arg) => {
        if (!arg?.rel) return;
        store.setFileClip('cut', [arg.rel]);
      },
    },
    {
      id: 'file.paste',
      title: '粘贴',
      group: '剪贴板',
      when: fileTreeWhen,
      default: 'Ctrl+V',
      source: 'system',
      enabled: () => store.fileClip !== null,
      run: async (arg) => {
        const touched = await store.pasteInto(targetDir(arg));
        if (touched.length > 0) {
          bus.emit('toast', { text: `已粘贴 ${touched.length} 项` });
        }
      },
    },
    {
      id: 'file.copyPath',
      title: '复制路径',
      group: '路径',
      when: fileTreeWhen,
      source: 'system',
      enabled: hasTarget,
      run: async (arg) => {
        if (!arg?.rel) return;
        const ok = await copyText(absolutePath(arg.rel));
        bus.emit('toast', {
          text: ok ? '已复制绝对路径' : '复制失败：剪贴板不可用',
          kind: ok ? 'ok' : 'err',
        });
      },
    },
    {
      id: 'file.copyRelPath',
      title: '复制相对路径',
      group: '路径',
      when: fileTreeWhen,
      source: 'system',
      enabled: hasTarget,
      run: async (arg) => {
        if (!arg?.rel) return;
        const ok = await copyText(arg.rel);
        bus.emit('toast', {
          text: ok ? '已复制相对路径' : '复制失败：剪贴板不可用',
          kind: ok ? 'ok' : 'err',
        });
      },
    },
    {
      id: 'file.rename',
      title: '重命名',
      group: '编辑',
      when: fileTreeWhen,
      default: 'F2',
      source: 'system',
      enabled: hasTarget,
      run: (arg) => (arg?.rel ? renamePrompt(arg.rel) : undefined),
    },
    {
      id: 'file.delete',
      title: '删除',
      group: '编辑',
      when: fileTreeWhen,
      default: 'Del',
      source: 'system',
      enabled: hasTarget,
      run: (arg) => (arg?.rel ? deletePrompt(arg.rel) : undefined),
    },
    {
      id: 'file.reveal',
      title: '在资源管理器中显示',
      group: '编辑',
      when: fileTreeWhen,
      source: 'system',
      enabled: hasTarget,
      run: async (arg) => {
        if (!arg?.rel) return;
        await api.revealInExplorer(arg.rel);
      },
    },
    {
      id: 'file.newFile',
      title: '新建文件',
      group: '新建',
      when: fileTreeWhen,
      source: 'system',
      run: (arg) => createFilePrompt(targetDir(arg)),
    },
    {
      id: 'file.newFolder',
      title: '新建文件夹',
      group: '新建',
      when: fileTreeWhen,
      source: 'system',
      run: (arg) => createFolderPrompt(targetDir(arg)),
    },
  ]);
}
