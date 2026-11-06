/**
 * 清理前端构建产物。
 *
 * 为什么不用 vite 的 `emptyOutDir`：它会一次性批量删除整个目录，在部分受管环境下
 * 会被安全策略拦截。两个 vite 配置因此都关掉了该选项，改由这里显式清理。
 *
 * 这个脚本必须真的存在——`vite.config.ts` 的注释一度写着「由 `npm run clean` 清理」，
 * 但 package.json 里从来没有这个脚本，于是每次构建都往旧目录里追加。哈希文件名每次都变，
 * 旧文件永不删除：本地 dist 累积到 106MB、dist-preview 到 81MB，后者被 `bundle.resources`
 * 整个打进安装包，NSIS 从 2.7MB 虚胖到 21MB。CI 是干净工作区，所以只有本地中招。
 * 见 `BugFix-261106-0001.md`。
 *
 * 删除策略是「先改名、再尽力删」而不是直接 rm -rf：
 * 受管环境会把递归删除重定向到回收站，回收站不可用时直接 fail-closed，
 * 那样构建会被清理步骤拖死。改名是原子的，路径立刻让出来；删除失败最多在 `.trash/`
 * 留下一个目录，下次构建开头再清，不会让产物变脏。
 */
import { rmSync, renameSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['dist', 'dist-preview'];
const TRASH_DIR = '.trash';

/** 删除尽力而为：失败只提示，不阻断构建。 */
function bestEffortRemove(path) {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.warn(`clean: 无法删除 ${path}（${err?.code ?? err}），留待下次清理`);
    return false;
  }
}

const trashRoot = resolve(root, TRASH_DIR);

// 先清掉上一次留下的残留，避免长期累积
if (existsSync(trashRoot)) {
  for (const entry of readdirSync(trashRoot)) {
    bestEffortRemove(join(trashRoot, entry));
  }
}

for (const dir of TARGETS) {
  const target = resolve(root, dir);
  if (!existsSync(target)) continue;

  let trashed = false;
  try {
    mkdirSync(trashRoot, { recursive: true });
    const trash = join(trashRoot, `${dir}-${Date.now()}`);
    renameSync(target, trash);
    trashed = true;
    console.log(`clean: ${dir}/ 已让出`);
  } catch (err) {
    console.warn(`clean: 无法移动 ${dir}/（${err?.code ?? err}），改为就地删除`);
  }

  if (!trashed) {
    bestEffortRemove(target);
    continue;
  }
  // 改名后立刻尝试真删，删不掉就留在 .trash/ 里，下次构建再试
  for (const entry of readdirSync(trashRoot)) {
    if (entry.startsWith(`${dir}-`)) bestEffortRemove(join(trashRoot, entry));
  }
}
