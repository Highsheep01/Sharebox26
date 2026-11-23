const config = require('../config')
const { request } = require('../utils/request')
const mock = require('./mock')

/**
 * ============================ 后端接口契约 ============================
 * useMock = false 时，以下接口由服务端提供；盒子侧建议通过 MQTT 与服务端通信。
 *
 * 1) POST /v1/orders                     创建订单
 *    body  { boxCode, items: [{ goodsId, count }] }
 *    resp  { orderId, orderNo, totalFee,
 *            payParams: { timeStamp, nonceStr, package, signType, paySign } }
 *    payParams 由服务端调用微信支付「JSAPI 统一下单」生成并返回（v3 接口的 prepay_id 即 package）。
 *
 * 2) POST /v1/orders/:orderId/unlock     支付成功后下发开锁指令
 *    resp  { cmdId, lockStatus: 'unlocking' }
 *    服务端需要做三件事：
 *      a. 校验订单状态（已支付、未开锁），保证幂等；
 *      b. 向对应设备下发开锁指令，例如 MQTT：
 *           下发 topic   sharebox/{deviceId}/cmd
 *           payload     { cmd:'unlock', cmdId, orderId, boxCode, lockId, ts, sign }
 *           上报 topic   sharebox/{deviceId}/state
 *           payload     { cmdId, orderId, lockStatus:'opened', doorStatus:'open', ts }
 *      c. 记录 cmdId，供前端轮询开锁回执。
 *
 * 3) GET /v1/orders/:orderId             查询订单（前端用它轮询开锁状态）
 *    resp  { orderId, orderNo, boxCode, boxName, totalFee, items,
 *            payStatus: 'unpaid'|'paid'|'failed'|'refunded',
 *            lockStatus: 'locked'|'unlocking'|'opened'|'failed',
 *            createdAt, paidAt, openedAt, failReason }
 *
 * 4) GET /v1/orders                      我的订单列表
 * 5) POST /v1/orders/:orderId/refund     开锁失败时退款
 * =====================================================================
 */

/** 创建订单 */
function createOrder({ boxCode, items }) {
  if (config.useMock) {
    return mock.delay(300).then(() => {
      const box = mock.getBox(boxCode)
      if (!box) throw new Error('盒子不存在')
      if (box.status !== 'online') throw new Error('盒子当前不在线，暂时无法下单')

      let totalFee = 0
      const detail = items.map((item) => {
        const goods = box.goods.find((g) => g.goodsId === item.goodsId)
        if (!goods) throw new Error('商品已下架，请刷新后重试')
        if (goods.stock < item.count) throw new Error(`${goods.name} 库存不足`)
        totalFee += goods.price * item.count
        return {
          goodsId: goods.goodsId,
          name: goods.name,
          price: goods.price,
          count: item.count,
        }
      })

      const now = Date.now()
      const order = {
        orderId: 'o_' + now + Math.floor(Math.random() * 1000),
        orderNo: mock.orderNo(),
        boxCode: box.boxCode,
        boxName: box.name,
        deviceId: box.deviceId,
        items: detail,
        totalFee,
        payStatus: 'unpaid',
        lockStatus: 'locked',
        createdAt: now,
        paidAt: 0,
        openedAt: 0,
        failReason: '',
        payParams: {
          timeStamp: String(Math.floor(now / 1000)),
          nonceStr: Math.random().toString(36).slice(2),
          package: 'prepay_id=mock' + now,
          signType: 'RSA',
          paySign: 'MOCK_SIGN',
        },
      }
      return mock.saveOrder(order)
    })
  }
  return request({ url: '/v1/orders', method: 'POST', data: { boxCode, items } })
}

/** 调起微信支付 */
function requestPayment(payParams) {
  if (config.useMock) {
    return new Promise((resolve, reject) => {
      wx.showModal({
        title: '模拟支付',
        content: '当前为本地模拟模式，未接入真实微信支付。确认模拟支付成功？',
        confirmText: '支付成功',
        cancelText: '取消支付',
        success(res) {
          if (res.confirm) resolve({ errMsg: 'requestPayment:ok' })
          else reject(new Error('requestPayment:fail cancel'))
        },
        fail() {
          reject(new Error('requestPayment:fail cancel'))
        },
      })
    })
  }
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...payParams,
      success: resolve,
      fail(err) {
        reject(new Error(err.errMsg || 'requestPayment:fail'))
      },
    })
  })
}

/** 通知服务端下发开锁指令 */
function unlockBox(orderId) {
  if (config.useMock) {
    return mock.delay(300).then(() => {
      const order = mock.getOrder(orderId)
      if (!order) throw new Error('订单不存在')
      if (order.payStatus !== 'paid') throw new Error('订单未支付，无法开锁')

      const box = mock.getBox(order.boxCode)
      if (!box || box.status !== 'online') {
        order.lockStatus = 'failed'
        order.failReason = '设备离线，未收到开锁指令'
        mock.saveOrder(order)
        return { cmdId: '', lockStatus: 'failed', reason: order.failReason }
      }

      const cmdId = 'cmd_' + Date.now()
      order.cmdId = cmdId
      order.lockStatus = 'unlocking'
      mock.saveOrder(order)

      // 模拟设备 1.2s 后开锁并上报状态
      setTimeout(() => {
        const latest = mock.getOrder(orderId)
        if (latest && latest.cmdId === cmdId && latest.lockStatus === 'unlocking') {
          latest.lockStatus = 'opened'
          latest.openedAt = Date.now()
          mock.saveOrder(latest)
        }
      }, 1200)

      return { cmdId, lockStatus: 'unlocking' }
    })
  }
  return request({ url: `/v1/orders/${orderId}/unlock`, method: 'POST' })
}

/** 查询订单（用于轮询开锁回执） */
function getOrder(orderId) {
  if (config.useMock) {
    return Promise.resolve(mock.getOrder(orderId))
  }
  return request({ url: `/v1/orders/${orderId}` })
}

/** 我的订单列表 */
function listOrders() {
  if (config.useMock) {
    return Promise.resolve(mock.listOrders())
  }
  return request({ url: '/v1/orders' })
}

/** 开锁失败后申请退款 */
function refundOrder(orderId) {
  if (config.useMock) {
    return mock.delay(300).then(() => {
      const order = mock.getOrder(orderId)
      if (order) {
        order.payStatus = 'refunded'
        mock.saveOrder(order)
      }
      return { orderId, payStatus: 'refunded' }
    })
  }
  return request({ url: `/v1/orders/${orderId}/refund`, method: 'POST' })
}

/** 本地记录支付结果（mock 模式需要；真实环境以服务端为准） */
function markPaid(orderId, paid) {
  if (!config.useMock) return Promise.resolve(null)
  const order = mock.getOrder(orderId)
  if (!order) return Promise.resolve(null)
  order.payStatus = paid ? 'paid' : 'failed'
  if (paid) order.paidAt = Date.now()
  return Promise.resolve(mock.saveOrder(order))
}

module.exports = {
  createOrder,
  requestPayment,
  unlockBox,
  getOrder,
  listOrders,
  refundOrder,
  markPaid,
}
