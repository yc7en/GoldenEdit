import * as api from '../bridge';
import { isMac } from '../commands/chords';
import { store } from '../store';
import type { PreviewHost } from '../preview/host';
import { closeModal, escapeHtml, openModal, toast } from '../ui/shell';

const WIDTHS: { label: string; value: number }[] = [
  { label: '980（GitHub）', value: 980 },
  { label: 'A4 794', value: 794 },
  { label: '390（手机）', value: 390 },
  { label: '自适应', value: 0 },
];

export function openExportDialog(preview: PreviewHost): void {
  const tab = store.activeTab;
  if (!tab) {
    toast('先打开一篇文档', 'err');
    return;
  }
  const cfg = store.settings.export;
  // macOS 的 WKWebView 不实现 window.print()，PDF 这条链路不存在（ARCHITECTURE §9.5）
  const mac = isMac();
  const initialFormat = mac && cfg.format === 'pdf' ? 'html' : cfg.format;
  const card = openModal(`
    <div class="modal__title">导出</div>
    <div class="modal__sub">内容由预览侧渲染后原样带出，保证与预览一致</div>
    <div class="modal__grid">
      <div>
        <div class="mrow">
          <label>格式</label>
          <div class="segs" id="exFormat">
            <button class="seg${initialFormat === 'html' ? ' seg--on' : ''}" data-format="html">单文件 HTML</button>
            <button class="seg${initialFormat === 'pdf' ? ' seg--on' : ''}" data-format="pdf"${
              mac ? ' disabled title="macOS 的 WebView 没有打印能力，PDF 导出不可用"' : ''
            }>PDF${mac ? '（macOS 不支持）' : ''}</button>
          </div>
        </div>
        <div class="mrow">
          <label>内容宽度</label>
          <select class="select" id="exWidth">
            ${WIDTHS.map(
              (w) => `<option value="${w.value}" ${w.value === cfg.width ? 'selected' : ''}>${w.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="mopts" id="exOptions">
          <label class="mopt"><input type="checkbox" id="exImg" ${cfg.inlineImages ? 'checked' : ''} />
            <span>内联图片与字体<span class="mopt__d">转成 base64，离线打开也不裂</span></span></label>
          <label class="mopt"><input type="checkbox" id="exCss" ${cfg.inlinePluginCss ? 'checked' : ''} />
            <span>内联插件样式<span class="mopt__d">不带则第三方插件的样式会丢</span></span></label>
          <label class="mopt"><input type="checkbox" id="exJs" ${cfg.inlinePluginScripts ? 'checked' : ''} />
            <span>带插件脚本<span class="mopt__d">体积变大，且导出文件会执行插件 JS</span></span></label>
        </div>
      </div>
      <div class="estimate" id="exEstimate"></div>
    </div>
    <div class="modal__foot">
      <span class="grow" style="font-size:10.5px;color:var(--t3)" id="exHint"></span>
      <button class="btn" data-close="modal">取消</button>
      <button class="btn btn--gold" id="exGo">导出</button>
    </div>
  `);

  const format = () => card.querySelector('.seg--on')?.getAttribute('data-format') ?? 'html';
  const width = () => Number((card.querySelector('#exWidth') as HTMLSelectElement).value);

  const updateEstimate = () => {
    const text = tab.text;
    const kb = Math.round(text.length / 1024);
    const inline = (card.querySelector('#exImg') as HTMLInputElement).checked;
    const estimated = Math.max(1, Math.round(kb * (inline ? 1.35 : 1)) + 12);
    const isHtml = format() === 'html';
    (card.querySelector('#exEstimate') as HTMLElement).innerHTML = isHtml
      ? `格式 <b>HTML</b><br>源文 ${kb} KB<br>预估输出 <b>${estimated} KB</b><br>宽度 ${width() || '自适应'}<br>图片 ${inline ? '已内联' : '保持外链'}`
      : `格式 <b>PDF</b><br>走系统打印对话框<br>纸张 <b>A4</b><br>宽度 ${width() || '自适应'}<br>页脚由打印设置决定`;
    (card.querySelector('#exHint') as HTMLElement).textContent = mac
      ? 'macOS 的 WebView 不支持打印，PDF 导出不可用；单文件 HTML 不受影响'
      : isHtml
        ? '导出的 HTML 与预览像素一致：同一段渲染代码'
        : 'PDF 通过打印对话框输出，选择「另存为 PDF」';
  };

  card.querySelectorAll('#exFormat .seg').forEach((el) => {
    el.addEventListener('click', () => {
      card.querySelectorAll('#exFormat .seg').forEach((s) => s.classList.remove('seg--on'));
      el.classList.add('seg--on');
      updateEstimate();
    });
  });
  ['#exWidth', '#exImg', '#exCss', '#exJs'].forEach((sel) => {
    card.querySelector(sel)?.addEventListener('change', updateEstimate);
  });
  updateEstimate();

  card.querySelector('#exGo')?.addEventListener('click', () => {
    void runExport(preview, tab.name, {
      format: format() as 'html' | 'pdf',
      width: width(),
      inlineImages: (card.querySelector('#exImg') as HTMLInputElement).checked,
      inlinePluginCss: (card.querySelector('#exCss') as HTMLInputElement).checked,
      inlinePluginScripts: (card.querySelector('#exJs') as HTMLInputElement).checked,
    });
  });
}

async function runExport(
  preview: PreviewHost,
  name: string,
  options: {
    format: 'html' | 'pdf';
    width: number;
    inlineImages: boolean;
    inlinePluginCss: boolean;
    inlinePluginScripts: boolean;
  }
): Promise<void> {
  await store.setSettingsPatch({ export: options });
  preview.setWidth(options.width);

  const baseName = name.replace(/\.[^.]+$/, '') || 'document';

  if (options.format === 'pdf') {
    // 兜底：正常路径下按钮已禁用，这里防的是持久化配置里的旧值绕过 UI
    if (isMac()) {
      toast('macOS 不支持 PDF 导出，请改用单文件 HTML', 'err');
      return;
    }
    const target = await api.saveDialog(`${baseName}.pdf`, [
      { name: 'PDF', extensions: ['pdf'] },
    ]);
    if (!target) return;
    try {
      await api.exportPdf(target);
    } catch (err) {
      if (err instanceof api.HostError && err.code === 'PRINT_FALLBACK') {
        closeModal();
        preview.requestPrint();
        toast('已打开打印对话框，选择「另存为 PDF」并指定刚才的位置');
        return;
      }
      if (err instanceof api.HostError && err.code === 'UNSUPPORTED') {
        toast('当前平台的 WebView 没有打印能力，PDF 导出不可用', 'err');
        return;
      }
      toast(`PDF 导出失败：${err instanceof Error ? err.message : String(err)}`, 'err');
      return;
    }
    return;
  }

  const target = await api.saveDialog(`${baseName}.html`, [
    { name: 'HTML', extensions: ['html'] },
  ]);
  if (!target) return;

  const id = Date.now();
  const onExported = (ev: Event) => {
    const detail = (ev as CustomEvent<{ id: number; html: string }>).detail;
    if (detail.id !== id) return;
    window.removeEventListener('ge:exported', onExported);
    void (async () => {
      try {
        await api.saveExport(target, detail.html);
        closeModal();
        toast(`已导出到 ${target}`);
      } catch (err) {
        toast(`写入失败：${(err as Error).message}`, 'err');
      }
    })();
  };
  window.addEventListener('ge:exported', onExported);
  closeModal();
  toast('正在渲染导出内容…');
  preview.requestExport(id, baseName);
}

export function renderExportSummary(): string {
  const text = store.activeTab?.text ?? '';
  return escapeHtml(`${Math.round(text.length / 1024)} KB`);
}
