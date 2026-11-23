// index.js
const config = require('../../config')
const { parsePageOptions, parseScanResult } = require('../../utils/qrcode')
const boxService = require('../../services/box')

Page({
  data: {
    codeInput: '',
    boxes: [],
    scanning: false,
  },

  onLoad(options) {
    // 扫码（普通链接二维码 / 小程序码）进入时，直接跳转到对应盒子
    const boxCode = parsePageOptions(options)
    if (boxCode) {
      this.setData({ codeInput: boxCode })
      setTimeout(() => this.openBox(boxCode), 100)
    }
    this.loadBoxes()
  },

  onShow() {
    this.setData({ scanning: false })
  },

  loadBoxes() {
    boxService
      .listBoxes()
      .then((list) => {
        this.setData({ boxes: list || [] })
      })
      .catch(() => {
        this.setData({ boxes: [] })
      })
  },

  /** 调起扫码 */
  onScan() {
    if (this.data.scanning) return
    this.setData({ scanning: true })

    wx.scanCode({
      scanType: ['qrCode', 'barCode'],
      success: (res) => {
        const { boxCode } = parseScanResult(res)
        if (!boxCode) {
          wx.showToast({ title: '未识别到盒子编号', icon: 'none' })
          return
        }
        this.openBox(boxCode)
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败，请重试', icon: 'none' })
        }
      },
      complete: () => {
        this.setData({ scanning: false })
      },
    })
  },

  onCodeInput(e) {
    this.setData({ codeInput: e.detail.value })
  },

  /** 手动输入盒子编号 */
  onSubmitCode() {
    const code = (this.data.codeInput || '').trim().toUpperCase()
    if (!code) {
      wx.showToast({ title: '请输入盒子编号', icon: 'none' })
      return
    }
    this.setData({ codeInput: code })
    this.openBox(code)
  },

  /** 不扫码，直接进入虚拟锁的控制页 */
  onOpenVirtual() {
    const boxCode = config.virtualBoxCode
    if (!boxCode) return
    this.openBox(boxCode)
  },

  openBoxByCode(e) {
    const code = e.currentTarget.dataset.code
    if (!code) return
    this.openBox(code)
  },

  /** 进入盒子详情页 */
  openBox(boxCode) {
    const app = getApp()
    if (app) app.globalData.boxCode = boxCode
    wx.navigateTo({
      url: `/pages/box/box?boxCode=${boxCode}`,
      fail: () => {
        wx.showToast({ title: '打开盒子失败', icon: 'none' })
      },
    })
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' })
  },
})
