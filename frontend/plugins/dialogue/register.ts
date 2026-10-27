import type MarkdownIt from 'markdown-it';
import type { PluginManifest, PluginRegister } from '../../src/plugins/types';

export const manifest: PluginManifest = {
  id: 'dialogue',
  name: '对白容器',
  version: '1.0.0',
  entry: 'register.ts',
  match: { container: ['dialogue'] },
  config: {},
};

export const register: PluginRegister = (md: MarkdownIt) => {
  const marker = ':';
  const markerCh = marker.charCodeAt(0);
  const minMarkers = 3;

  const container = (state: any, startLine: number, endLine: number, silent: boolean) => {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    if (pos + marker.length > max) return false;
    let count = 0;
    while (pos + marker.length <= max && state.src.charCodeAt(pos) === markerCh) {
      count++; pos += marker.length;
    }
    if (count < minMarkers) return false;
    const params = state.src.slice(pos, max).trim();
    if (params.split(' ', 1)[0] !== 'dialogue') return false;
    if (silent) return true;

    let next = startLine + 1;
    let closeLine = -1;
    for (; next < endLine; next++) {
      const p = state.bMarks[next] + state.tShift[next];
      const e = state.eMarks[next];
      if (p >= e) continue;
      if (state.src.charCodeAt(p) !== markerCh) continue;
      let c = 0;
      let q = p;
      while (state.src.charCodeAt(q) === markerCh) { c++; q++; }
      if (c >= minMarkers && state.src.slice(q, e).trim() === '') { closeLine = next; break; }
    }
    if (closeLine < 0) return false;

    const open = state.push('container_dialogue_open', 'div', 1);
    open.block = true;
    open.map = [startLine, closeLine];
    state.md.block.tokenize(state, startLine + 1, closeLine);
    state.push('container_dialogue_close', 'div', -1);
    state.line = closeLine + 1;
    return true;
  };

  md.block.ruler.before('fence', 'container_dialogue', container, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.container_dialogue_open = () => '<div class="ge-dialogue">\n';
  md.renderer.rules.container_dialogue_close = () => '</div>\n';
};

export default { manifest, register };
