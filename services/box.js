const config = require('../config')
const { request } = require('../utils/request')
const mock = require('./mock')

/** 小程序内虚拟锁的开锁回执，供控制页轮询 */
const virtualLock = {
  lockStatus: 'locked',
  failReason: '',
  cmdId: '',
  updatedAt: 0,
  timer: null,
}

function isLocalVirtual(boxCode) {
  return !!config.localVirtualLock && boxCode === config.virtualBoxCode
}

function virtualBox(boxCode) {
  return {
    boxCode,
    name: '虚拟电磁锁',
    deviceId: 'virtual_1001',
    address: '小程序内虚拟设备',
    status: 'online',
    notice: '这是虚拟锁。开锁指令会让锁舌收回，大约 1 秒后完成',
    goods: [],
  }
}

function virtualListItem() {
  const box = virtualBox(config.virtualBoxCode)
  return {
    boxCode: box.boxCode,
    name: box.name,
    address: box.address,
    status: box.status,
    goodsCount: 0,
  }
}

/**
 * 获取盒子详情（含盒内商品）
 * 真实接口：GET /v1/boxes/:boxCode
 */
function getBoxDetail(boxCode) {
  if (isLocalVirtual(boxCode)) {
    return Promise.resolve(virtualBox(boxCode))
  }
  if (config.useMock) {
    return mock.delay(300).then(() => {
      const box = mock.getBox(boxCode)
      if (!box) {
        const err = new Error('未找到该盒子，请确认二维码是否正确')
        err.code = 404
        throw err
      }
      return box
    })
  }
  return request({ url: `/v1/boxes/${encodeURIComponent(boxCode)}` })
}

/**
 * 盒子列表（首页演示 / 后台管理用）
 * 真实接口：GET /v1/boxes
 */
function listBoxes() {
  if (config.localVirtualLock) {
    return Promise.resolve([virtualListItem()])
  }
  if (config.useMock) {
    return mock.delay(200).then(() => mock.listBoxes())
  }
  return request({ url: '/v1/boxes' })
}

/**
 * 直接开锁：通知服务端经 MQTT 让 ESP32 吸合继电器
 * POST /v1/boxes/:boxCode/unlock
 * 这条链路不走本地 mock，需要 server 和设备在线。
 */
function unlockBox(boxCode) {
  if (isLocalVirtual(boxCode)) {
    if (virtualLock.timer) {
      clearTimeout(virtualLock.timer)
      virtualLock.timer = null
    }
    const cmdId = 'cmd_' + Date.now()
    virtualLock.cmdId = cmdId
    virtualLock.lockStatus = 'unlocking'
    virtualLock.failReason = ''
    virtualLock.updatedAt = Date.now()
    virtualLock.timer = setTimeout(() => {
      if (virtualLock.cmdId !== cmdId) return
      virtualLock.lockStatus = 'opened'
      virtualLock.updatedAt = Date.now()
      virtualLock.timer = null
    }, 1000)
    return Promise.resolve({ cmdId, lockStatus: 'unlocking' })
  }
  return request({
    url: `/v1/boxes/${encodeURIComponent(boxCode)}/unlock`,
    method: 'POST',
  })
}

/**
 * 查询开锁回执
 * GET /v1/boxes/:boxCode/lock
 */
function getLockStatus(boxCode) {
  if (isLocalVirtual(boxCode)) {
    return Promise.resolve({
      boxCode,
      cmdId: virtualLock.cmdId,
      lockStatus: virtualLock.lockStatus,
      failReason: virtualLock.failReason,
      online: true,
      updatedAt: virtualLock.updatedAt,
    })
  }
  return request({ url: `/v1/boxes/${encodeURIComponent(boxCode)}/lock` })
}

module.exports = { getBoxDetail, listBoxes, unlockBox, getLockStatus }
