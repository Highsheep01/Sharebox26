/**
 * 本地模拟数据（仅 useMock = true 时使用）
 * 真实环境下这些数据由后端 / 设备上报提供
 */
const { orderNo } = require('../utils/format')

const ORDER_KEY = 'mock_orders'

/** 盒子与盒内商品（price 单位：分） */
const boxes = [
  {
    boxCode: 'BOX1001',
    name: '共享盒子 · A 座大堂',
    deviceId: 'dev_1001',
    address: '科技园 A 座 1 层大堂 · 电梯口右侧',
    status: 'online',
    notice: '取货后请随手关门，谢谢配合',
    goods: [
      { goodsId: 'G001', name: '冰镇可乐 330ml', desc: '冷藏 · 畅爽解渴', price: 500, stock: 8, tag: '热销' },
      { goodsId: 'G002', name: '苏打气泡水 400ml', desc: '0 糖 0 脂', price: 450, stock: 6, tag: '' },
      { goodsId: 'G003', name: '现烤手撕面包', desc: '当日现烤 · 请尽快食用', price: 880, stock: 3, tag: '限量' },
      { goodsId: 'G004', name: '每日坚果 25g', desc: '6 种果仁混合', price: 690, stock: 10, tag: '' },
      { goodsId: 'G005', name: '冰凉贴（单片装）', desc: '户外降温 · 应急必备', price: 380, stock: 0, tag: '' },
    ],
  },
  {
    boxCode: 'BOX1002',
    name: '共享盒子 · B 座 3 层',
    deviceId: 'dev_1002',
    address: '科技园 B 座 3 层 · 茶水间旁',
    status: 'online',
    notice: '本盒支持微信支付，暂不支持现金',
    goods: [
      { goodsId: 'G011', name: '现磨拿铁（冷）', desc: '冷藏即饮 · 270ml', price: 1200, stock: 5, tag: '新品' },
      { goodsId: 'G012', name: '酸奶水果杯', desc: '低脂 · 需冷藏', price: 990, stock: 4, tag: '' },
      { goodsId: 'G013', name: '卤蛋（2 枚）', desc: '常温 · 即食', price: 500, stock: 12, tag: '' },
    ],
  },
  {
    boxCode: 'BOX2001',
    name: '共享盒子 · 园区西门',
    deviceId: 'dev_2001',
    address: '园区西门岗亭旁（户外）',
    status: 'offline',
    notice: '设备维护中，暂时无法开门',
    goods: [
      { goodsId: 'G021', name: '矿泉水 550ml', desc: '常温', price: 300, stock: 20, tag: '' },
    ],
  },
]

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getBox(boxCode) {
  const box = boxes.find((item) => item.boxCode === boxCode)
  if (!box) return null
  // 深拷贝，避免页面直接改动模拟数据源
  return JSON.parse(JSON.stringify(box))
}

function listBoxes() {
  return boxes.map((box) => ({
    boxCode: box.boxCode,
    name: box.name,
    address: box.address,
    status: box.status,
    goodsCount: box.goods.length,
  }))
}

function readOrders() {
  try {
    return wx.getStorageSync(ORDER_KEY) || []
  } catch (e) {
    return []
  }
}

function writeOrders(list) {
  try {
    wx.setStorageSync(ORDER_KEY, list)
  } catch (e) {
    // ignore
  }
}

function listOrders() {
  return readOrders().sort((a, b) => b.createdAt - a.createdAt)
}

function saveOrder(order) {
  const list = readOrders()
  const index = list.findIndex((item) => item.orderId === order.orderId)
  if (index > -1) list[index] = order
  else list.unshift(order)
  writeOrders(list)
  return order
}

function getOrder(orderId) {
  return readOrders().find((item) => item.orderId === orderId) || null
}

module.exports = {
  delay,
  getBox,
  listBoxes,
  listOrders,
  saveOrder,
  getOrder,
  orderNo,
}
