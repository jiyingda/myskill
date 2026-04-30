import { spawn } from 'node:child_process';
import os from 'node:os';

/**
 * 跨平台打开默认浏览器，零依赖。
 * 返回 true 表示子进程已成功 spawn（不代表浏览器一定打开了）。
 */
export async function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url.replace(/&/g, '^&')];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      detached: true,
      shell: false,
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function osInfo() {
  return `${process.platform} ${os.release()}`;
}
