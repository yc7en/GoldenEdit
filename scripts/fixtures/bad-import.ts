// 故意违规的 fixture：只用于验证边界检查真的能拦住 Tauri API 的越界 import。
// 这个文件不参与构建，也不被任何入口引用。
import { invoke } from '@tauri-apps/api/core';

export const bad = () => invoke('read_doc', { rel: 'x.md' });
