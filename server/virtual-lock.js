const mqtt = require('mqtt')
const config = require('./config')

const PULSE_MS = 3000

/**
 * 进程内的虚拟电磁锁，走和 ESP32 固件相同的 MQTT 协议。
 * 客户端 ID 为 sharebox_<盒子编号>。接上真机后把 config.virtualLock 设为 false，避免和固件抢同一个客户端。
 */
function startVirtualLock() {
  config.boxes.forEach((box) => connectBox(box))
}

function connectBox(box) {
  const cmdTopic = `sharebox/${box.boxCode}/cmd`
  const stateTopic = `sharebox/${box.boxCode}/state`
  const client = mqtt.connect(`mqtt://127.0.0.1:${config.mqttPort}`, {
    clientId: `sharebox_${box.boxCode}`,
    reconnectPeriod: 2000,
    will: {
      topic: stateTopic,
      payload: JSON.stringify({ lockStatus: 'offline' }),
      qos: 0,
      retain: false,
    },
  })

  client.on('connect', () => {
    client.subscribe(cmdTopic, (err) => {
      if (err) {
        console.error(`[virtual-lock] subscribe failed ${box.boxCode}:`, err.message)
        return
      }
      console.log(`[virtual-lock] online ${box.boxCode}`)
    })
  })

  client.on('message', (topic, payload) => {
    if (topic !== cmdTopic) return
    let body = {}
    try {
      body = JSON.parse(payload.toString())
    } catch (err) {
      return
    }
    if (body.cmd !== 'unlock') return

    const cmdId = body.cmdId || ''
    if (body.token !== config.unlockToken) {
      console.log(`[virtual-lock] reject ${box.boxCode} ${cmdId}`)
      publish(client, stateTopic, { cmdId, lockStatus: 'failed', reason: '口令不正确', ts: Date.now() })
      return
    }

    console.log(`[virtual-lock] retract ${box.boxCode} ${cmdId}`)
    publish(client, stateTopic, { cmdId, lockStatus: 'opened', ts: Date.now() })
    setTimeout(() => {
      console.log(`[virtual-lock] release ${box.boxCode} ${cmdId}`)
    }, PULSE_MS)
  })

  client.on('error', (err) => {
    console.error(`[virtual-lock] ${box.boxCode}:`, err.message)
  })
}

function publish(client, topic, payload) {
  client.publish(topic, JSON.stringify(payload), { qos: 0, retain: false })
}

module.exports = { startVirtualLock }
