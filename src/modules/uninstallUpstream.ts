import * as vscode from 'vscode';
import logger from '../logger';

/**
 * 上游扩展 ID（已停止维护）。
 *
 * 本 fork（ACE SFTP）与上游的命令 ID、视图 ID、context key 完全相同，
 * 两个扩展**不能并存** —— 后激活者注册同名命令会抛
 * `command 'sftp.xxx' already exists`，且 RemoteExplorer 的树视图会建立失败。
 *
 * 因此本扩展激活时检测到上游仍在安装时，主动请求卸载它。
 */
const UPSTREAM_EXTENSION_ID = 'natizyskunk.sftp';

/** 主线程侧的扩展卸载命令（VS Code 内置 CommandAction，参数为扩展 ID）。 */
const UNINSTALL_COMMAND = 'workbench.extensions.uninstallExtension';

/** 本扩展自己的 ID —— 避免误把自己卸载掉。 */
const SELF_EXTENSION_ID = 'ace.ace-sftp';

/**
 * 检查扩展是否已安装。
 */
function isInstalled(extensionId: string): boolean {
  return vscode.extensions.all.some((ext) => ext.id.toLowerCase() === extensionId.toLowerCase());
}

/**
 * 请求卸载上游扩展。
 *
 * 用 `workbench.extensions.uninstallExtension` 而非直接删目录：
 * 前者走 VS Code 官方卸载流程（会弹确认对话框、清理扩展状态），
 * 后者会留下不一致的 extensions.json 与残留状态。
 */
async function requestUninstall(extensionId: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand(UNINSTALL_COMMAND, extensionId);
    return true;
  } catch (error) {
    logger.error(`Failed to uninstall '${extensionId}': ${error}`, 'uninstallUpstream');
    return false;
  }
}

/**
 * 上游是否已经激活（其命令已注册）。
 *
 * 激活顺序由 VS Code 决定，不可控。若上游先激活，它已经占用了 `sftp.*` 命令，
 * 本扩展后续注册同名命令会抛 `command 'sftp.xxx' already exists`。
 * 这种情况下即便请求卸载，也需要重启 VS Code 才能彻底生效。
 */
function isUpstreamActive(): boolean {
  return vscode.extensions.all.some(
    (ext) => ext.id.toLowerCase() === UPSTREAM_EXTENSION_ID.toLowerCase() && ext.isActive
  );
}

/**
 * 若上游扩展仍在安装，则请求卸载。
 *
 * 时序说明：
 * 1. 本函数在 `initCommands` 之前调用 —— 尽量在注册同名命令**之前**把上游请走。
 * 2. 若上游抢先激活（VS Code 的激活顺序不可控），本次卸载请求依然会发出，
 *    但它占用的命令要等重启 VS Code 后才彻底释放。
 * 3. 卸载动作会弹出 VS Code 的确认对话框，由用户决定是否确认。
 */
export async function uninstallUpstreamIfPresent(): Promise<void> {
  if (UPSTREAM_EXTENSION_ID.toLowerCase() === SELF_EXTENSION_ID.toLowerCase()) {
    return;
  }

  if (!isInstalled(UPSTREAM_EXTENSION_ID)) {
    return;
  }

  const upstreamAlreadyActive = isUpstreamActive();

  logger.info(
    `Detected upstream extension '${UPSTREAM_EXTENSION_ID}'` +
      `${upstreamAlreadyActive ? ' (already active)' : ''} — requesting uninstall ` +
      `(this fork cannot coexist with it: identical command/view IDs).`,
    'uninstallUpstream'
  );

  const ok = await requestUninstall(UPSTREAM_EXTENSION_ID);

  if (!ok) {
    vscode.window.showWarningMessage(
      `ACE SFTP: 无法自动卸载上游扩展 '${UPSTREAM_EXTENSION_ID}'。` +
        `两个版本不能同时使用（命令 ID 相同会冲突），请手动卸载上游扩展。`
    );
    return;
  }

  if (upstreamAlreadyActive) {
    vscode.window.showWarningMessage(
      `ACE SFTP: 已请求卸载上游扩展 '${UPSTREAM_EXTENSION_ID}'。` +
        `它已在本窗口激活并占用了同名命令，请重启 VS Code 以完全生效。`
    );
  }
}
