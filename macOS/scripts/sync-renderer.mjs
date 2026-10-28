import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const project = process.cwd();
const source = path.resolve(project, '..', 'Приложение', 'Исходники');
const output = path.join(project, 'renderer');

try {
  await access(path.join(source, 'ui.html'));
} catch {
  await access(path.join(output, 'ui.html'));
  await access(path.join(output, 'updates.js'));
  await access(path.join(output, 'updates.css'));
  console.log('Исходники Windows не найдены; используется сохранённый macOS-интерфейс.');
  process.exit(0);
}

await mkdir(output, { recursive: true });
await cp(path.join(source, 'updates.js'), path.join(output, 'updates.js'));
await cp(path.join(source, 'updates.css'), path.join(output, 'updates.css'));

let html = await readFile(path.join(source, 'ui.html'), 'utf8');
html = html
  .replace('font-family:"Segoe UI",Arial,sans-serif', 'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Arial,sans-serif')
  .replace('<script src="updates.js"></script>', '<script>window.chrome=window.chrome||{};window.chrome.webview=window.teacherBridge;</script><script src="updates.js"></script>')
  .replace('Открыть в Edge', 'Открыть во внешнем браузере')
  .replaceAll('Скопируйте всю папку приложения на флешку.', 'Сохраните копию аккаунтов на флешку.')
  .replaceAll('Копия аккаунтов обновляется автоматически при закрытии приложения. На другом компьютере запустите приложение из скопированной папки. Доступные данные входа восстановятся автоматически.', 'Нажмите «Сохранить копию», запишите файл на флешку, а на другом Mac выберите «Восстановить». Копия содержит вкладки, cookies и доступные входы.')
  .replaceAll('Обновить копию для переноса', 'Сохранить копию')
  .replaceAll('Обновить копию…', 'Сохраняем копию…')
  .replaceAll('Обычно входы восстанавливаются автоматически при первом запуске на другом компьютере. Если нужно, нажмите кнопку ниже для ручного восстановления из файла «Перенос аккаунтов.kfb».', 'Выберите файл `.kfb` с флешки. Текущие вкладки, cookies и данные входа будут заменены данными из копии.');

await writeFile(path.join(output, 'ui.html'), html, 'utf8');
console.log('Интерфейс macOS синхронизирован с преподавательской программой.');
