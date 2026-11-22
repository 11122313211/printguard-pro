/* ====================================================================
 * PrintGuard 提取 · Illustrator 脚本菜单入口
 * --------------------------------------------------------------------
 * 安装：将本文件与 host.jsx 一起拷入
 *   <Illustrator 安装目录>\Presets\zh_CN\Scripts\
 * 重启后出现在 文件 > 脚本 > PrintGuard提取
 * ==================================================================== */
(function () {
  try {
    var lib = new File(File($.fileName).parent.fsName + '/host.jsx');
    if (!lib.exists) {
      alert('PrintGuard 提取：未找到 host.jsx（需与本脚本同目录）\n' + lib.fsName);
      return;
    }
    $.evalFile(lib);
    if (typeof PrintGuardBridge === 'undefined') {
      alert('PrintGuard 提取：桥接库加载失败');
      return;
    }
    PrintGuardBridge.openDialog();
  } catch (e) {
    alert('PrintGuard 提取出错：' + (e && e.message ? e.message : e));
  }
})();
