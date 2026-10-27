import { PluginManager } from '../plugins/manager';

/**
 * 设置面板：按 PluginManager.list() 自动生成插件勾选表 + config 表单。
 */
export function renderSettings(manager: PluginManager) {
  const panel = document.getElementById('settings-body')!;
  const list = manager.list();
  panel.innerHTML = '';
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'setting-row';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = p.enabled;
    toggle.onchange = () => {
      manager.applySettings({ plugins: { [p.id]: { enabled: toggle.checked } } });
      window.dispatchEvent(new CustomEvent('ge:settings-changed'));
    };

    const label = document.createElement('span');
    label.textContent = `${p.name} (v${p.version})`;

    row.appendChild(toggle);
    row.appendChild(label);

    // config 表单
    for (const [key, field] of Object.entries(p.configSchema)) {
      const fieldRow = document.createElement('div');
      fieldRow.className = 'setting-field';
      fieldRow.style.marginLeft = '24px';
      if (field.type === 'boolean') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = Boolean(p.config[key] ?? field.default);
        fieldRow.appendChild(cb);
      } else if (field.type === 'select') {
        const sel = document.createElement('select');
        (field.options ?? []).forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o; opt.textContent = o;
          sel.appendChild(opt);
        });
        sel.value = String(p.config[key] ?? field.default);
        fieldRow.appendChild(sel);
      } else {
        const inp = document.createElement('input');
        inp.type = field.type === 'number' ? 'number' : 'text';
        inp.value = String(p.config[key] ?? field.default);
        fieldRow.appendChild(inp);
      }
      const lbl = document.createElement('label');
      lbl.textContent = field.label ?? key;
      fieldRow.appendChild(lbl);
      row.appendChild(fieldRow);
    }

    panel.appendChild(row);
  }
}
