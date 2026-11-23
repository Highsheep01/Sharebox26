const config = require('./config')

App({
  globalData: {
    openid: '',
    /** 最近一次扫码识别到的盒子编号 */
    boxCode: '',
  },

  onLaunch() {
    this.login()
  },

  /**
   * 登录换取 openid
   * 真实环境：wx.login → code → 后端调用 code2Session → 返回 openid
   */
  login() {
    if (config.useMock) {
      let openid = ''
      try {
        openid = wx.getStorageSync('mock_openid') || ''
      } catch (e) {
        openid = ''
      }
      if (!openid) {
        openid = 'mock_openid_' + Date.now().toString(36)
        try {
          wx.setStorageSync('mock_openid', openid)
        } catch (e) {
          // ignore
        }
      }
      this.globalData.openid = openid
      return Promise.resolve(openid)
    }

    return new Promise((resolve) => {
      wx.login({
        success: (res) => {
          if (!res.code) return resolve('')
          wx.request({
            url: config.apiBase + '/v1/auth/login',
            method: 'POST',
            data: { code: res.code },
            success: (resp) => {
              const data = (resp.data && resp.data.data) || {}
              this.globalData.openid = data.openid || ''
              resolve(this.globalData.openid)
            },
            fail: () => resolve(''),
          })
        },
        fail: () => resolve(''),
      })
    })
  },
})
