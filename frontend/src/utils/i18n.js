// ============================================================
//  Q14 三态语言切换（zh / en / both）
//
//  仅翻译前端"固定 UI 文案"（按钮、弹窗标题、提示等）；
//  后台配置的内容型文案（顶部提示语、差评原因、感谢语）按管理员填写原文显示，
//  因为没有翻译来源 —— 这部分在任意语言下都按原样展示。
//
//  t(zh, en)：
//    · lang = 'zh'  → 返回中文
//    · lang = 'en'  → 返回英文
//    · lang = 'both'→ 返回「中文 / 英文」同屏（用" / "分隔，兼容按钮/标题单行渲染）
// ============================================================
import { settings } from './settings.js'

export function t(zh, en) {
  const lang = settings.value?.lang || 'zh'
  if (lang === 'en') return en
  if (lang === 'both') return `${zh} / ${en}`
  return zh
}
