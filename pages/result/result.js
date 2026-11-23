// pages/result/result.js
const config = require('../../config')
const orderService = require('../../services/order')
const { formatPrice, fenToYuan, formatTime } = require('../../utils/format')

/** 取货倒计时（秒） */
const PICKUP_SECONDS = 60

const PHASES = {
  unpaid: {
    stepIndex: 0,
    icon: '💳',
    title: '待支付',
    desc: '完成支付后，系统会立即向盒子下发开锁指令',
    titleClass: 'title-normal',
  },
  paying: {
    stepIndex: 0,
    icon: '💳',
    title: '正在唤起微信支付…',
    desc: '请在微信支付页面完成付款',
    titleClass: 'title-normal',
  },
  payFailed: {
    stepIndex: 0,
    icon: '⚠️',
    title: '支付未完成',
    desc: '支付已取消或失败，盒门未打开，不会产生扣款',
    titleClass: 'title-danger',
  },
  unlocking: {
    stepIndex: 1,
    icon: '📡',
    title: '正在打开盒门…',
    desc: '已向盒子下发开锁指令，等待设备回执',
    titleClass: 'title-normal',
  },
  opened: {
    stepIndex: 3,
    icon: '🎉',
    title: '盒门已打开',
    desc: '请取走所选商品并随手关门',
    titleClass: 'title-success',
  },
  unlockFailed: {
    stepIndex: 1,
    icon: '🔧',
    title: '盒门未能打开',
    desc: '设备未响应开锁指令，可重试或申请退款',
    titleClass: 'title-danger',
  },
  refunded: {
    stepIndex: 0,
    icon: '↩️',
    title: '已提交退款',
    desc: '退款将原路退回，如有疑问请联系客服',
    titleClass: 'title-normal',
  },
}

Page({
  data: {
    orderId: '',
    order: null,
    error: '',
    phase: 'unpaid',
    icon: PHASES.unpaid.icon,
    title: PHASES.unpaid.title,
    desc: PHASES.unpaid.desc,
    titleClass: PHASES.unpaid.titleClass,
    stepIndex: 0,
    failReason: '',
    countdown: 0,
    busy: false,
  },

  onLoad(options) {
    const orderId = options.orderId || ''
    if (!orderId) {
      this.setData({ error: '订单不存在，请重新扫码' })
      return
    }
    this.setData({ orderId })
    this.loadOrder()
  },

  onShow() {
    // 页面重新可见时，恢复取货倒计时；开锁回执轮询若已中断则补上
    if (this.data.phase === 'opened' && !this.countdownTimer) {
      this.startCountdown()
    }
    if (this.data.phase === 'unlocking' && !this.pollTimer) {
      this.startPoll()
    }
  },

  onUnload() {
    this.clearPoll()
    this.clearCountdown()
  },

  loadOrder() {
    return orderService
      .getOrder(this.data.orderId)
      .then((order) => {
        if (!order) {
          this.setData({ error: '订单不存在，请重新扫码' })
          return
        }
        const view = {
          ...order,
          totalYuan: formatPrice(order.totalFee),
          createdAtText: formatTime(order.createdAt),
          items: (order.items || []).map((item) => ({
            ...item,
            amountYuan: fenToYuan(item.price * item.count),
          })),
        }
        this.setData({ order: view })
        this.syncPhase(view)
      })
      .catch(() => {
        this.setData({ error: '订单加载失败' })
      })
  },

  /** 根据订单当前状态决定页面阶段（支持重新进入页面时续接流程） */
  syncPhase(order) {
    if (order.lockStatus === 'opened') return this.setPhase('opened')
    if (order.payStatus === 'refunded') return this.setPhase('refunded')
    if (order.payStatus === 'paid') return this.doUnlock()
    return this.setPhase('unpaid')
  },

  setPhase(phase, failReason = '') {
    const preset = PHASES[phase] || PHASES.unpaid
    this.setData({
      phase,
      icon: preset.icon,
      title: preset.title,
      desc: preset.desc,
      titleClass: preset.titleClass,
      stepIndex: preset.stepIndex,
      failReason,
    })
    if (phase === 'opened') this.startCountdown()
    else this.clearCountdown()
  },

  /** 步骤一：调起微信支付 */
  startPay() {
    const { order, busy } = this.data
    if (!order || busy) return
    this.setData({ busy: true })
    this.setPhase('paying')

    orderService
      .requestPayment(order.payParams)
      .then(() => orderService.markPaid(this.data.orderId, true))
      .then(() => this.loadOrder())
      .then(() => this.doUnlock())
      .catch((err) => {
        const msg = (err && err.message) || ''
        if (msg.indexOf('cancel') > -1) {
          this.setPhase('unpaid')
          wx.showToast({ title: '支付已取消', icon: 'none' })
        } else {
          this.setPhase('payFailed', msg)
        }
      })
      .then(() => {
        this.setData({ busy: false })
      })
  },

  /** 步骤二：通知服务端向盒子下发开锁指令 */
  doUnlock() {
    this.setPhase('unlocking')
    return orderService
      .unlockBox(this.data.orderId)
      .then((res) => {
        if (res && res.lockStatus === 'failed') {
          this.setPhase('unlockFailed', res.reason || '设备未响应')
          return
        }
        this.startPoll()
      })
      .catch((err) => {
        this.setPhase('unlockFailed', (err && err.message) || '开锁指令下发失败')
      })
  },

  onRetryUnlock() {
    if (this.data.busy) return
    this.doUnlock()
  },

  /** 步骤三：轮询设备开锁回执 */
  startPoll() {
    this.clearPoll()
    const startedAt = Date.now()

    this.pollTimer = setInterval(() => {
      orderService
        .getOrder(this.data.orderId)
        .then((order) => {
          if (!order) return
          if (order.lockStatus === 'opened') {
            this.clearPoll()
            this.loadOrder()
          } else if (order.lockStatus === 'failed') {
            this.clearPoll()
            this.setPhase('unlockFailed', order.failReason || '设备未响应')
          } else if (Date.now() - startedAt > config.unlockTimeout) {
            this.clearPoll()
            this.setPhase('unlockFailed', '开锁超时，设备未响应')
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

  startCountdown() {
    this.clearCountdown()
    this.setData({ countdown: PICKUP_SECONDS })
    this.countdownTimer = setInterval(() => {
      const next = this.data.countdown - 1
      if (next <= 0) {
        this.clearCountdown()
        this.setData({ countdown: 0 })
        return
      }
      this.setData({ countdown: next })
    }, 1000)
  },

  clearCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
  },

  onRefund() {
    wx.showModal({
      title: '申请退款',
      content: '盒门未能打开，确认申请退款？退款将原路退回。',
      confirmText: '申请退款',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '提交中', mask: true })
        orderService
          .refundOrder(this.data.orderId)
          .then(() => {
            wx.hideLoading()
            this.loadOrder()
          })
          .catch((err) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '退款申请失败', icon: 'none' })
          })
      },
    })
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  },
})
