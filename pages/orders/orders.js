// pages/orders/orders.js
const orderService = require('../../services/order')
const { formatPrice, formatTime } = require('../../utils/format')

function statusOf(order) {
  if (order.payStatus === 'refunded') return { statusText: '已退款', tagClass: 'gray' }
  if (order.payStatus !== 'paid') return { statusText: '待支付', tagClass: 'gray' }
  if (order.lockStatus === 'opened') return { statusText: '已开锁', tagClass: 'green' }
  if (order.lockStatus === 'failed') return { statusText: '开锁失败', tagClass: 'red' }
  return { statusText: '待开门', tagClass: '' }
}

Page({
  data: {
    orders: [],
    loading: true,
  },

  onShow() {
    this.loadOrders()
  },

  loadOrders() {
    orderService
      .listOrders()
      .then((list) => {
        const orders = (list || []).map((order) => {
          const status = statusOf(order)
          return {
            ...order,
            totalYuan: formatPrice(order.totalFee),
            timeText: formatTime(order.createdAt),
            summary: (order.items || []).map((item) => `${item.name} × ${item.count}`).join('、'),
            statusText: status.statusText,
            tagClass: status.tagClass,
            canReopen: order.payStatus === 'paid' && order.lockStatus !== 'opened',
          }
        })
        this.setData({ orders, loading: false })
      })
      .catch(() => {
        this.setData({ orders: [], loading: false })
      })
  },

  openDetail(e) {
    const orderId = e.currentTarget.dataset.id
    if (!orderId) return
    wx.navigateTo({ url: `/pages/result/result?orderId=${orderId}` })
  },

  /** 已支付但未开门的订单，重新下发开锁指令 */
  onReopen(e) {
    const orderId = e.currentTarget.dataset.id
    if (!orderId) return
    wx.navigateTo({ url: `/pages/result/result?orderId=${orderId}` })
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  },
})
