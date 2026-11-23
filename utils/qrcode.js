const config = require('../config')

const CODE_RE = /^[A-Za-z0-9_-]{4,32}$/
const KV_RE = /(?:bc|boxCode|box|code|id)=([A-Za-z0-9_-]+)/i

function safeDecode(str) {
  try {
    return decodeURIComponent(String(str))
  } catch (e) {
    return String(str)
  }
}

/**
 * 从任意来源的字符串中尽力提取盒子编号
 * 支持：
 *   https://s.sharebox.com/b/BOX1001
 *   https://s.sharebox.com/b/BOX1001?from=timeline
 *   pages/box/box?bc=BOX1001      （小程序码 path）
 *   bc=BOX1001                    （小程序码 scene）
 *   BOX1001                       （手动输入 / 纯编号二维码）
 *
 * @returns {string} 盒子编号，解析失败返回空串
 */
function extractBoxCode(raw) {
  if (!raw) return ''
  let s = safeDecode(raw).trim()

  // 1. 优先识别 key=value 形式
  const kv = s.match(KV_RE)
  if (kv && CODE_RE.test(kv[1])) return kv[1]

  // 2. 去掉 hash 与 query，取路径最后一段
  s = s.split('#')[0]
  const qIndex = s.indexOf('?')
  if (qIndex > -1) s = s.slice(0, qIndex)

  const seg = s.split('/').filter(Boolean).pop() || ''
  return CODE_RE.test(seg) ? seg : ''
}

/**
 * 解析页面 onLoad 的 options
 * 覆盖三种打开方式：普通链接二维码（options.q）、小程序码（options.scene）、页面间跳转直接传参
 *
 * @returns {string} 盒子编号
 */
function parsePageOptions(options = {}) {
  const candidates = [options.q, options.scene, options.boxCode, options.code, options.id]
  for (let i = 0; i < candidates.length; i += 1) {
    const code = extractBoxCode(candidates[i])
    if (code) return code
  }
  return ''
}

/**
 * 解析 wx.scanCode 的返回结果
 * @returns {{ boxCode: string, raw: string }}
 */
function parseScanResult(res = {}) {
  const list = [res.path, res.rawData, res.result]
  for (let i = 0; i < list.length; i += 1) {
    const boxCode = extractBoxCode(list[i])
    if (boxCode) return { boxCode, raw: list[i] }
  }
  return { boxCode: '', raw: res.result || '' }
}

/** 生成贴在盒子上的二维码内容（用于后台批量生成二维码） */
function buildBoxUrl(boxCode) {
  return config.qrLinkPrefix + boxCode
}

module.exports = {
  extractBoxCode,
  parsePageOptions,
  parseScanResult,
  buildBoxUrl,
}
