// ============================================================
//  全站可配置项（酒店名称 / 文案 / 好评与差评原因列表）
//
//  打开页面时从后端 /api/settings/public 拉取（该接口开放，客人页不需要登录）。
//  拉不到就用下面的内置默认值 —— 保证"后端没起来/网络不通"时客人页照样能打开、能提交，
//  绝不会因为配置拉取失败而白屏。
// ============================================================
import { ref } from 'vue'
import { api } from '../api/http.js'

export const DEFAULT_SETTINGS = {
  hotelName: '城市酒店',
  hotelNameEn: '',
  guestPrompt: '请您为本次入住体验评分',
  positiveMsg: '感谢您的反馈！',
  negativeMsg: '已收到您的反馈，我们会立即改进！',
  positiveReasons: ['服务态度好', '房间干净', '设施完善', '位置方便', '性价比高', '早餐丰富'],
  negativeReasons: ['服务态度差', '房间不干净', '设施故障', '噪音大', '网络差', '其他'],
}

// 只接受结构正确的字段，其余一律回落默认值（防止后端返回 null / 错类型导致页面崩掉）
function sanitize(data) {
  const out = { ...DEFAULT_SETTINGS }
  if (!data || typeof data !== 'object') return out

  for (const k of ['hotelName', 'hotelNameEn', 'guestPrompt', 'positiveMsg', 'negativeMsg']) {
    if (typeof data[k] === 'string' && data[k].trim()) out[k] = data[k]
  }
  for (const k of ['positiveReasons', 'negativeReasons']) {
    if (Array.isArray(data[k])) {
      out[k] = data[k].filter(x => typeof x === 'string' && x.trim())
    }
  }
  return out
}

export const settings = ref({ ...DEFAULT_SETTINGS })

export async function loadSettings() {
  try {
    const res = await api.get('/settings/public')
    settings.value = sanitize(res.data)
  } catch {
    settings.value = { ...DEFAULT_SETTINGS }
  }
  return settings.value
}
