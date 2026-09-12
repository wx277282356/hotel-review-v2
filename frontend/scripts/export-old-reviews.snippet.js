// ============================================================
//  旧系统评价导出片段（不是网页，是给「浏览器控制台」粘贴的代码）
//  用法：
//   1. 用原来跑旧系统的那台设备/浏览器，打开旧点评页
//        https://wx277282356.github.io/hotel-review/
//   2. 按 F12 打开开发者工具 → Console（控制台）
//   3. 把下面整段粘贴进去回车 → 浏览器会自动下载 hotel-review-old-reviews.json
//   4. 把下载的 json 文件交给我（或放进本仓库 scripts/ 目录），我跑迁移脚本导入新库
//  注意：
//   - localStorage 是按「设备+浏览器」隔离的，每台提交过评价的平板/电脑都要各导一次。
//   - 如果这台设备不方便开控制台（iPad / 安卓平板基本开不了），
//     可改用旧系统后台的「明细记录 → 导出 Excel」，效果一样：
//       打开旧系统 → 右下角「⚙ 管理」登录 → 明细记录
//       → ⚠️ 先把开始/结束日期两个框清空（默认只筛最近 30 天，不清会漏数据）
//       → 点「📥 导出 Excel」，把 xlsx 交给迁移脚本即可（支持 .xlsx）
// ============================================================
(function () {
  try {
    const raw = localStorage.getItem('hr_reviews');
    if (!raw) { alert('未找到旧评价数据（hr_reviews 为空）。这台设备可能没有提交过评价。'); return; }
    const data = JSON.parse(raw);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hotel-review-old-reviews.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    alert('已导出 ' + data.length + ' 条旧评价 → hotel-review-old-reviews.json');
  } catch (e) {
    alert('导出失败：' + e.message);
  }
})();
