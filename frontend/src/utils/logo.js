// 品牌 LOGO 解析：优先用酒店管理人员在后台上传的 LOGO，取不到则回退到内置默认 LOGO
// - 默认 LOGO 随 GitHub Pages 子路径适配（import.meta.env.BASE_URL）
// - 上传的 LOGO 由后端提供：GET <apiBase>/settings/logo
// - 用 localStorage 里的版本号做缓存失效，换图后各端刷新即生效
import { ref } from 'vue'
import { getApiBase } from '../api/http.js'

const DEFAULT_LOGO = import.meta.env.BASE_URL + 'logo.png'
const VERSION_KEY = 'logo_version'

export const logoUrl = ref(DEFAULT_LOGO)

export function defaultLogo() {
  return DEFAULT_LOGO
}

// 记录一次上传，令其他端下次加载时取到新图
export function bumpLogoVersion(v) {
  localStorage.setItem(VERSION_KEY, String(v || Date.now()))
}

// 探测后端是否有自定义 LOGO；有则替换 logoUrl。失败静默回退默认图（不影响页面）
export async function resolveLogo() {
  const ver = localStorage.getItem(VERSION_KEY) || ''
  const url = getApiBase() + '/settings/logo' + (ver ? '?v=' + encodeURIComponent(ver) : '')
  try {
    const res = await fetch(url, { method: 'GET' })
    if (res.ok) {
      logoUrl.value = url
      return url
    }
  } catch {
    /* 后端不可达时忽略 */
  }
  logoUrl.value = DEFAULT_LOGO
  return DEFAULT_LOGO
}
