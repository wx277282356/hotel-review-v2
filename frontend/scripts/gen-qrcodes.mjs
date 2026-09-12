// 批量生成每间客房的点评二维码 + 下载页
// 用法：node scripts/gen-qrcodes.mjs
// 换域名 / 换酒店名时不必改代码，用环境变量覆盖后重跑即可：
//   SITE_BASE=https://review.xxx.com HOTEL_NAME=某某酒店 node scripts/gen-qrcodes.mjs
// 生成完记得 npm run deploy 推上线。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')
const OUT_DIR = path.join(PUBLIC, 'qrcodes')
const ROOMS_FILE = path.join(__dirname, 'rooms.txt')

// ★ 部署后的前端地址（GitHub Pages 测试期）。换客户自有域名时用 SITE_BASE 环境变量覆盖。
const SITE_BASE = (process.env.SITE_BASE || 'https://wx277282356.github.io/hotel-review-v2').replace(/\/+$/, '')
// ★ 酒店名称，仅影响下载页的标题文字（二维码本身只含房间号，与名称无关）。
//   应与后台「站点设置」里的酒店名称保持一致。
const HOTEL_NAME = process.env.HOTEL_NAME || '城市酒店'

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function readRooms() {
  const raw = fs.readFileSync(ROOMS_FILE, 'utf-8')
  return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

function buildDownloadPage(rooms) {
  const name = escapeHtml(HOTEL_NAME)
  const total = rooms.length
  const cards = rooms.map(r => `
    <div class="card" data-room="${escapeHtml(r)}">
      <div class="room">${escapeHtml(r)}</div>
      <img src="./${escapeHtml(r)}.png" alt="房间 ${escapeHtml(r)} 点评二维码" loading="lazy" />
      <div class="acts">
        <a class="dl" href="./${escapeHtml(r)}.png" download>⬇ 下载</a>
        <button type="button" class="cp" data-room="${escapeHtml(r)}">📋 复制</button>
      </div>
    </div>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${name} · 客房评价二维码下载</title>
<style>
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:#f5f3ee;color:#333;}
  header{padding:16px 20px;background:#fff;border-bottom:1px solid #eee;position:sticky;top:0;z-index:5;}
  .title h1{font-size:1.1rem;margin:0;color:#a07d1f;}
  .tip{font-size:.82rem;color:#888;margin-top:4px;}
  .toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;}
  #search{padding:8px 12px;border:1px solid #d8d2c4;border-radius:8px;font-size:.9rem;min-width:200px;}
  .count{font-size:.82rem;color:#666;white-space:nowrap;}
  button{padding:8px 16px;border:1px solid #c9a84c;background:#fff;color:#a07d1f;border-radius:8px;cursor:pointer;font-size:.85rem;}
  button:disabled{opacity:.6;cursor:default;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;padding:18px;}
  .card{background:#fff;border:1px solid #eee;border-radius:12px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05);}
  .card[hidden]{display:none;}
  .room{font-weight:700;font-size:1.05rem;margin-bottom:8px;color:#444;}
  .card img{width:130px;height:130px;object-fit:contain;cursor:pointer;}
  .acts{display:flex;gap:8px;justify-content:center;align-items:center;margin-top:8px;flex-wrap:wrap;}
  .dl{font-size:.8rem;color:#a07d1f;text-decoration:none;}
  .cp{padding:4px 10px;font-size:.78rem;background:#faf7ef;}
  footer{padding:20px;background:#fff;border-top:1px solid #eee;color:#555;font-size:.85rem;line-height:1.7;}
  footer h3{margin:0 0 8px;color:#a07d1f;font-size:1rem;}
  footer ul{margin:0;padding-left:20px;}
  .modal{position:fixed;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;z-index:50;}
  .modal.open{display:flex;}
  .modal-box{background:#fff;border-radius:12px;padding:18px;max-width:90vw;text-align:center;position:relative;}
  .modal-box img{width:280px;height:280px;object-fit:contain;}
  .modal-room{font-weight:700;margin:10px 0;color:#444;}
  .modal-close{position:absolute;top:8px;right:8px;border:none;background:transparent;font-size:1.2rem;color:#888;cursor:pointer;}
  @media print{
    header{position:static;}
    .toolbar,.acts,.modal{display:none !important;}
    body{background:#fff;}
    .card{box-shadow:none;border:1px solid #ccc;break-inside:avoid;}
  }
</style>
</head>
<body>
  <header>
    <div class="title">
      <h1>${name} · 客房评价二维码</h1>
      <div class="tip">共 ${total} 间 · 扫码即进入该房间点评页 · 可批量打印后裁剪贴于客房</div>
    </div>
    <div class="toolbar">
      <input id="search" type="search" placeholder="🔍 搜索房间号…" />
      <span id="count" class="count"></span>
      <button id="zipBtn" type="button">📦 打包下载 ZIP</button>
      <button type="button" onclick="window.print()">🖨 打印</button>
    </div>
  </header>
  <div class="grid" id="grid">${cards}</div>
  <div id="modal" class="modal">
    <div class="modal-box">
      <button id="modalClose" class="modal-close" type="button">✕</button>
      <img id="modalImg" alt="预览" />
      <div id="modalRoom" class="modal-room"></div>
      <a id="modalDl" class="dl" download>⬇ 下载此二维码</a>
    </div>
  </div>
  <footer>
    <h3>使用说明</h3>
    <ul>
      <li>每个二维码仅含房间号，扫码后用微信或浏览器打开即进入该房间的点评页。</li>
      <li>打印：点「🖨 打印」选 A4，建议每页排 4–6 个，裁剪后塑封贴于客房门后或床头。</li>
      <li>批量下载：点「📦 打包下载 ZIP」可一次性下载当前筛选出的所有二维码（PNG）。</li>
      <li>复制：点卡片上的「📋 复制」直接把二维码图复制到剪贴板，可粘到微信或文档。</li>
      <li>搜索：上方输入框输入房间号（如 8、1801）即可快速定位。</li>
      <li>更换域名或酒店名后需重跑生成脚本，重新输出本页与全部二维码。</li>
    </ul>
  </footer>
  <script>
  (function(){
    var grid = document.getElementById('grid');
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
    var search = document.getElementById('search');
    var countEl = document.getElementById('count');
    var zipBtn = document.getElementById('zipBtn');
    var total = cards.length;
    function updateCount(){
      var shown = grid.querySelectorAll('.card:not([hidden])').length;
      countEl.textContent = '当前显示 ' + shown + ' / ' + total + ' 间';
    }
    search.addEventListener('input', function(){
      var q = search.value.trim().toLowerCase();
      cards.forEach(function(c){
        var room = c.getAttribute('data-room') || '';
        c.hidden = q !== '' && room.toLowerCase().indexOf(q) === -1;
      });
      updateCount();
    });
    var modal = document.getElementById('modal');
    var modalImg = document.getElementById('modalImg');
    var modalRoom = document.getElementById('modalRoom');
    var modalDl = document.getElementById('modalDl');
    grid.addEventListener('click', function(e){
      var img = e.target.closest('img');
      if(!img) return;
      var card = img.closest('.card');
      var room = card.getAttribute('data-room');
      modalImg.src = img.src;
      modalRoom.textContent = '房间 ' + room;
      modalDl.href = img.getAttribute('src');
      modalDl.setAttribute('download', room + '.png');
      modal.classList.add('open');
    });
    modal.addEventListener('click', function(e){
      if(e.target === modal || e.target.id === 'modalClose') modal.classList.remove('open');
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') modal.classList.remove('open'); });
    grid.addEventListener('click', function(e){
      var btn = e.target.closest('.cp');
      if(!btn) return;
      var room = btn.getAttribute('data-room');
      copyPng('./' + room + '.png', btn);
    });
    function copyPng(url, btn){
      fetch(url).then(function(r){ return r.blob(); }).then(function(blob){
        if(navigator.clipboard && window.ClipboardItem){
          navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]).then(function(){
            flash(btn, '已复制 ✓');
          }).catch(function(){ fallbackDownload(url, btn); });
        } else { fallbackDownload(url, btn); }
      }).catch(function(){ flash(btn, '请通过网页链接打开', true); });
    }
    function fallbackDownload(url, btn){
      var a = document.createElement('a');
      a.href = url; a.download = ''; a.click();
      flash(btn, '已下载 ✓');
    }
    function flash(btn, text, warn){
      var old = btn.textContent;
      btn.textContent = text;
      btn.style.color = warn ? '#c0392b' : '';
      setTimeout(function(){ btn.textContent = old; btn.style.color = ''; }, 1600);
    }
    function crc32(buf){
      var c, t = crc32.t;
      if(!t){
        t = crc32.t = new Uint32Array(256);
        for(var n=0;n<256;n++){ c=n; for(var k=0;k<8;k++){ c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); } t[n] = c>>>0; }
      }
      var crc = 0xFFFFFFFF;
      for(var i=0;i<buf.length;i++){ crc = (crc>>>8) ^ t[(crc ^ buf[i]) & 0xFF]; }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }
    function downloadZip(files){
      var enc = new TextEncoder();
      var parts = [];
      var central = [];
      var offset = 0;
      files.forEach(function(f){
        var data = f.data;
        var nameBytes = enc.encode(f.name);
        var crc = crc32(data);
        var size = data.length;
        var lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true);
        lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
        lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
        lh.setUint32(14, crc, true);
        lh.setUint32(18, size, true); lh.setUint32(22, size, true);
        lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true);
        var lhB = new Uint8Array(lh.buffer);
        parts.push(lhB, nameBytes, data);
        var cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true);
        cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0, true);
        cd.setUint16(10, 0, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0, true);
        cd.setUint32(16, crc, true);
        cd.setUint32(20, size, true); cd.setUint32(24, size, true);
        cd.setUint16(28, nameBytes.length, true);
        cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true);
        cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
        central.push(new Uint8Array(cd.buffer), nameBytes);
        offset += lhB.length + nameBytes.length + size;
      });
      var cdSize = 0; central.forEach(function(a){ cdSize += a.length; });
      var eocd = new DataView(new ArrayBuffer(22));
      eocd.setUint32(0, 0x06054b50, true);
      eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true);
      eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
      eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
      eocd.setUint16(20, 0, true);
      parts = parts.concat(central, [new Uint8Array(eocd.buffer)]);
      var blob = new Blob(parts, { type: 'application/zip' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qrcodes.zip';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
    }
    var done = false;
    function maybeFinish(files, zipBtn, oldText){
      if(done) return; done = true;
      if(files.length) downloadZip(files);
      zipBtn.disabled = false; zipBtn.textContent = oldText;
      if(!files.length) flash(zipBtn, '无可见二维码', true);
    }
    zipBtn.addEventListener('click', function(){
      var visible = grid.querySelectorAll('.card:not([hidden])');
      if(visible.length === 0){ return; }
      done = false;
      zipBtn.disabled = true;
      var oldText = zipBtn.textContent;
      zipBtn.textContent = '打包中 ' + visible.length + ' 张…';
      var files = [];
      var pending = visible.length;
      visible.forEach(function(c){
        var room = c.getAttribute('data-room');
        fetch('./' + room + '.png').then(function(r){ return r.arrayBuffer(); }).then(function(buf){
          files.push({ name: room + '.png', data: new Uint8Array(buf) });
        }).catch(function(){}).then(function(){
          pending--; if(pending === 0) maybeFinish(files, zipBtn, oldText);
        });
      });
    });
    updateCount();
  })();
  </script>
</body>
</html>`
}

async function main() {
  const rooms = readRooms()
  fs.mkdirSync(OUT_DIR, { recursive: true })

  for (const r of rooms) {
    const url = `${SITE_BASE}/?room=${encodeURIComponent(r)}`
    await QRCode.toFile(path.join(OUT_DIR, `${r}.png`), url, {
      width: 420,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' }
    })
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildDownloadPage(rooms), 'utf-8')
  console.log(`✅ 已生成 ${rooms.length} 个房间二维码 + 下载页 -> public/qrcodes/`)
}

main().catch(e => { console.error(e); process.exit(1) })
