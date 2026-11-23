// pages/box/box.js
const config = require('../../config')
const { parsePageOptions } = require('../../utils/qrcode')
const boxService = require('../../services/box')
const orderService = require('../../services/order')
const { formatPrice } = require('../../utils/format')

const AVATAR_COLORS = ['#3a86ff', '#ff8f1f', '#07c160', '#7c5cff', '#00b8d9', '#fa5151']

function readableError(err) {
  const msg = (err && err.message) || ''
  if (msg.indexOf('url not in domain list') !== -1) {
    return '开发者工具拦截了本地接口，请重新编译后再试'
  }
  return msg || '盒子识别失败'
}

const PHASES = {
  unlocking: {
    icon: '📡',
    title: '正在打开盒门…',
    desc: '已向盒子下发开锁指令，等待电磁锁收回',
    titleClass: 'title-normal',
  },
  opened: {
    icon: '🎉',
    title: '锁已收回',
    desc: '电磁锁已收回，请拉开盒门',
    titleClass: 'title-success',
  },
  failed: {
    icon: '🔧',
    title: '开锁失败',
    desc: '设备未完成开锁，可以重试',
    titleClass: 'title-danger',
  },
}

Page({
  data: {
    directUnlock: !!config.directUnlock,
    boxCode: '',
    box: null,
    goods: [],
    loading: true,
    error: '',
    totalCount: 0,
    totalFee: 0,
    totalYuan: '0',
    canSubmit: false,
    submitText: '请选择商品',
    submitting: false,
    phase: '',
    icon: '',
    title: '',
    desc: '',
    titleClass: '',
    failReason: '',
  },

  onLoad(options) {
    const app = getApp()
    const boxCode = parsePageOptions(options) || (app && app.globalData.boxCode) || ''

    if (!boxCode) {
      this.setData({ loading: false, error: '缺少盒子编号，请重新扫描盒身上的二维码' })
      return
    }

    this.setData({ boxCode })
    if (app) app.globalData.boxCode = boxCode
    this.loadBox(boxCode)
  },

  onShow() {
    if (this.data.submitting) this.setData({ submitting: false })
  },

  onUnload() {
    this.clearPoll()
  },

  loadBox(boxCode) {
    this.setData({ loading: true, error: '' })

    boxService
      .getBoxDetail(boxCode)
      .then((box) => {
        const goods = (box.goods || []).map((item, index) => ({
          ...item,
          count: 0,
          initial: item.name.charAt(0),
          priceYuan: formatPrice(item.price),
          avatarBg: AVATAR_COLORS[index % AVATAR_COLORS.length],
          last: index === box.goods.length - 1,
        }))
        this.setData({ box, goods, loading: false })
        if (config.directUnlock) {
          if (!this.autoUnlockSent) {
            this.autoUnlockSent = true
            this.startUnlock()
          }
        } else {
          this.recalc()
        }
      })
      .catch((err) => {
        this.setData({ loading: false, error: readableError(err) })
      })
  },

  onReload() {
    if (this.data.boxCode) this.loadBox(this.data.boxCode)
  },

  onPlus(e) {
    const index = Number(e.currentTarget.dataset.index)
    const goods = this.data.goods[index]
    if (!goods) return
    if (goods.count >= goods.stock) {
      wx.showToast({ title: '库存不足', icon: 'none' })
      return
    }
    this.updateCount(index, goods.count + 1)
  },

  onMinus(e) {
    const index = Number(e.currentTarget.dataset.index)
    const goods = this.data.goods[index]
    if (!goods || goods.count <= 0) return
    this.updateCount(index, goods.count - 1)
  },

  updateCount(index, count) {
    this.setData({ [`goods[${index}].count`]: count })
    this.recalc()
  },

  recalc() {
    let totalFee = 0
    let totalCount = 0
    this.data.goods.forEach((item) => {
      totalFee += item.price * item.count
      totalCount += item.count
    })

    const online = this.data.box && this.data.box.status === 'online'
    let submitText = '去结算'
    if (!online) submitText = '盒子离线'
    else if (totalCount === 0) submitText = '请选择商品'

    this.setData({
      totalFee,
      totalCount,
      totalYuan: formatPrice(totalFee),
      canSubmit: !!online && totalCount > 0,
      submitText,
    })
  },

  onSubmit() {
    const { box, goods, canSubmit, submitting, totalCount, totalYuan } = this.data
    if (!canSubmit || submitting) return

    const items = goods
      .filter((item) => item.count > 0)
      .map((item) => ({ goodsId: item.goodsId, count: item.count }))
    if (!items.length) return

    wx.showModal({
      title: '确认下单',
      content: `${box.name}\n共 ${totalCount} 件商品，合计 ¥${totalYuan}\n支付完成后盒子将自动弹开`,
      confirmText: '去支付',
      cancelText: '再看看',
      success: (res) => {
        if (res.confirm) this.createOrder(items)
      },
    })
  },

  createOrder(items) {
    this.setData({ submitting: true })
    wx.showLoading({ title: '创建订单', mask: true })

    orderService
      .createOrder({ boxCode: this.data.boxCode, items })
      .then((order) => {
        wx.hideLoading()
        wx.redirectTo({ url: `/pages/result/result?orderId=${order.orderId}` })
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        wx.showToast({ title: (err && err.message) || '下单失败', icon: 'none' })
      })
  },

  setPhase(phase, failReason = '') {
    const preset = PHASES[phase] || PHASES.failed
    this.setData({
      phase,
      icon: preset.icon,
      title: preset.title,
      desc: preset.desc,
      titleClass: preset.titleClass,
      failReason,
    })
  },

  setOnline(online) {
    if (!this.data.box) return
    this.setData({ 'box.status': online ? 'online' : 'offline' })
  },

  /** 向服务端要一次开锁，设备在线后开始轮询回执 */
  startUnlock() {
    if (this.data.phase === 'unlocking') return
    this.clearPoll()
    this.setPhase('unlocking')

    boxService
      .unlockBox(this.data.boxCode)
      .then((res) => {
        if (res && res.lockStatus === 'failed') {
          this.setOnline(false)
          this.setPhase('failed', res.reason || res.failReason || '设备未响应')
          return
        }
        this.setOnline(true)
        this.startPoll()
      })
      .catch((err) => {
        this.setPhase('failed', (err && err.message) || '开锁指令下发失败')
      })
  },

  onRetryUnlock() {
    this.startUnlock()
  },

  startPoll() {
    this.clearPoll()
    const startedAt = Date.now()

    this.pollTimer = setInterval(() => {
      boxService
        .getLockStatus(this.data.boxCode)
        .then((res) => {
          if (!res) return
          if (typeof res.online === 'boolean') this.setOnline(res.online)
          if (res.lockStatus === 'opened') {
            this.clearPoll()
            this.setPhase('opened')
          } else if (res.lockStatus === 'failed') {
            this.clearPoll()
            this.setPhase('failed', res.failReason || '设备未响应')
          } else if (Date.now() - startedAt > config.unlockTimeout) {
            this.clearPoll()
            this.setPhase('failed', '开锁超时，设备未响应')
          }
        })
        .catch(() => {})
    }, config.unlockPollInterval)
  },

  clearPoll() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  },
})
