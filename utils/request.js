const config = require('../config')

/**
 * 统一请求封装
 * 约定后端返回结构：{ code: 0, message: 'ok', data: {...} }
 */
function request({ url, method = 'GET', data = {}, header = {} }) {
  return new Promise((resolve, reject) => {
    const app = typeof getApp === 'function' ? getApp() : null
    const openid = (app && app.globalData && app.globalData.openid) || ''

    wx.request({
      url: config.apiBase + url,
      method,
      data,
      header: Object.assign({ 'content-type': 'application/json', 'x-openid': openid }, header),
      timeout: config.timeout,
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          resolve(body.data)
        } else {
          reject(new Error(body.message || `请求失败（${res.statusCode}）`))
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络异常，请稍后重试'))
      },
    })
  })
}

module.exports = { request }
