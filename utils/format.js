/** 分 → 元（保留两位小数字符串） */
function fenToYuan(fen) {
  const n = Number(fen) || 0
  return (n / 100).toFixed(2)
}

/** 分 → 展示用金额（整数分位为 0 时不显示小数） */
function formatPrice(fen) {
  const yuan = fenToYuan(fen)
  return yuan.replace(/\.00$/, '')
}

/** 时间戳 → YYYY-MM-DD HH:mm */
function formatTime(ts) {
  const d = new Date(Number(ts) || Date.now())
  const pad = (v) => (v < 10 ? '0' + v : String(v))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 生成订单号（仅 mock 使用，真实环境由后端生成） */
function orderNo() {
  const d = new Date()
  const pad = (v) => (v < 10 ? '0' + v : String(v))
  const rand = Math.floor(Math.random() * 1e6).toString().padStart(6, '0')
  return `SB${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${rand}`
}

module.exports = { fenToYuan, formatPrice, formatTime, orderNo }
