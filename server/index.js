const http = require('http')
const net = require('net')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { Aedes } = require('aedes')
const config = require('./config')
const { startVirtualLock } = require('./virtual-lock')

const publicDir = path.join(__dirname, 'public')

/** boxCode -> { online, lockStatus, failReason, cmdId, updatedAt } */
const runtime = new Map()
/** boxCode -> Set<clientId> */
const connected = new Map()

config.boxes.forEach((box) => ensure(box.boxCode))

function ensure(boxCode) {
  if (!runtime.has(boxCode)) {
    runtime.set(boxCode, {
      online: false,
      lockStatus: 'locked',
      failReason: '',
      cmdId: '',
      updatedAt: 0,
    })
  }
  return runtime.get(boxCode)
}

function findBox(boxCode) {
  return config.boxes.find((box) => box.boxCode === boxCode) || null
}

function boxFromClientId(clientId) {
  const prefix = 'sharebox_'
  if (!clientId || clientId.indexOf(prefix) !== 0) return ''
  return clientId.slice(prefix.length)
}

function boxDetail(box) {
  const state = ensure(box.boxCode)
  return {
    boxCode: box.boxCode,
    name: box.name,
    deviceId: box.deviceId,
    address: box.address,
    status: state.online ? 'online' : 'offline',
    notice: box.notice,
    goods: box.goods || [],
  }
}

function lockView(boxCode) {
  const state = ensure(boxCode)
  return {
    boxCode,
    cmdId: state.cmdId,
    lockStatus: state.lockStatus,
    failReason: state.failReason,
    online: state.online,
    updatedAt: state.updatedAt,
  }
}

let broker = null

function publish(topic, payload) {
  return new Promise((resolve, reject) => {
    broker.publish(
      {
        cmd: 'publish',
        qos: 0,
        dup: false,
        retain: false,
        topic,
        payload: Buffer.from(JSON.stringify(payload)),
      },
      (err) => (err ? reject(err) : resolve())
    )
  })
}

function attachBroker(instance) {
  broker = instance

  instance.on('clientReady', (client) => {
    const boxCode = boxFromClientId(client.id)
    if (!boxCode || !findBox(boxCode)) return
    if (!connected.has(boxCode)) connected.set(boxCode, new Set())
    connected.get(boxCode).add(client.id)
    const state = ensure(boxCode)
    state.online = true
    console.log(`[mqtt] online ${boxCode} (${client.id})`)
  })

  instance.on('clientDisconnect', (client) => {
    const boxCode = boxFromClientId(client.id)
    if (!boxCode) return
    const set = connected.get(boxCode)
    if (set) set.delete(client.id)
    if (!set || set.size === 0) {
      ensure(boxCode).online = false
      console.log(`[mqtt] offline ${boxCode} (${client.id})`)
    }
  })

  instance.on('publish', (packet, client) => {
    if (!client) return
    const topic = packet.topic || ''
    const matched = topic.match(/^sharebox\/([^/]+)\/state$/)
    if (!matched) return

    const boxCode = matched[1]
    if (!findBox(boxCode)) return

    let body = {}
    try {
      body = JSON.parse(packet.payload.toString())
    } catch (err) {
      return
    }

    const state = ensure(boxCode)
    if (body.lockStatus === 'offline') {
      state.online = false
      if (state.lockStatus === 'unlocking') {
        state.lockStatus = 'failed'
        state.failReason = '设备离线'
        state.updatedAt = Date.now()
      }
      return
    }

    if (body.cmdId && state.cmdId && body.cmdId !== state.cmdId) return
    if (body.lockStatus !== 'opened' && body.lockStatus !== 'failed') return

    state.lockStatus = body.lockStatus
    state.failReason = body.reason || body.failReason || ''
    state.updatedAt = Date.now()
    if (body.cmdId) state.cmdId = body.cmdId
    console.log(`[mqtt] ${boxCode} ${state.lockStatus} ${state.cmdId}`)
  })

  instance.on('clientError', (client, err) => {
    console.error(`[mqtt] client error ${client && client.id}:`, err.message)
  })
}

function send(res, statusCode, code, message, data) {
  if (res.headersSent) return
  const body = JSON.stringify({ code, message, data })
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-openid',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function contentType(filePath) {
  if (filePath.endsWith('.txt')) return 'text/plain; charset=utf-8'
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function tryStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const decoded = decodeURIComponent(pathname)
  if (decoded.indexOf('\0') !== -1) return false
  const filePath = path.normalize(path.join(publicDir, decoded))
  if (filePath !== publicDir && filePath.indexOf(publicDir + path.sep) !== 0) return false
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch (err) {
    return false
  }
  if (!stat.isFile()) return false
  res.writeHead(200, {
    'content-type': contentType(filePath),
    'content-length': stat.size,
  })
  if (req.method === 'HEAD') res.end()
  else fs.createReadStream(filePath).pipe(res)
  return true
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1e6) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch (err) {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-openid',
    })
    res.end()
    return
  }

  const url = new URL(req.url, 'http://127.0.0.1')
  const pathname = url.pathname

  if (req.method === 'GET' && pathname === '/') {
    send(res, 200, 0, 'ok', { ok: true })
    return
  }

  if (req.method === 'POST' && pathname === '/v1/auth/login') {
    await readBody(req)
    send(res, 200, 0, 'ok', { openid: 'dev_openid' })
    return
  }

  if (req.method === 'GET' && pathname === '/v1/boxes') {
    send(res, 200, 0, 'ok', config.boxes.map((box) => {
      const detail = boxDetail(box)
      return {
        boxCode: detail.boxCode,
        name: detail.name,
        address: detail.address,
        status: detail.status,
        goodsCount: detail.goods.length,
      }
    }))
    return
  }

  const unlockMatch = pathname.match(/^\/v1\/boxes\/([^/]+)\/unlock$/)
  if (req.method === 'POST' && unlockMatch) {
    await readBody(req)
    const boxCode = decodeURIComponent(unlockMatch[1])
    const box = findBox(boxCode)
    if (!box) {
      send(res, 404, 404, '未找到该盒子，请确认二维码是否正确', null)
      return
    }
    const state = ensure(boxCode)
    if (!state.online) {
      const reason = '设备离线，未连接到服务器'
      state.lockStatus = 'failed'
      state.failReason = reason
      state.cmdId = ''
      state.updatedAt = Date.now()
      send(res, 200, 0, 'ok', { cmdId: '', lockStatus: 'failed', reason, failReason: reason })
      return
    }

    const cmdId = 'cmd_' + Date.now()
    state.cmdId = cmdId
    state.lockStatus = 'unlocking'
    state.failReason = ''
    state.updatedAt = Date.now()

    await publish(`sharebox/${boxCode}/cmd`, {
      cmd: 'unlock',
      cmdId,
      ts: Date.now(),
      token: config.unlockToken,
    })
    console.log(`[http] unlock ${boxCode} ${cmdId}`)
    send(res, 200, 0, 'ok', { cmdId, lockStatus: 'unlocking' })
    return
  }

  const lockMatch = pathname.match(/^\/v1\/boxes\/([^/]+)\/lock$/)
  if (req.method === 'GET' && lockMatch) {
    const boxCode = decodeURIComponent(lockMatch[1])
    if (!findBox(boxCode)) {
      send(res, 404, 404, '未找到该盒子，请确认二维码是否正确', null)
      return
    }
    send(res, 200, 0, 'ok', lockView(boxCode))
    return
  }

  const boxMatch = pathname.match(/^\/v1\/boxes\/([^/]+)$/)
  if (req.method === 'GET' && boxMatch) {
    const boxCode = decodeURIComponent(boxMatch[1])
    const box = findBox(boxCode)
    if (!box) {
      send(res, 404, 404, '未找到该盒子，请确认二维码是否正确', null)
      return
    }
    send(res, 200, 0, 'ok', boxDetail(box))
    return
  }

  if (tryStatic(req, res, pathname)) return
  send(res, 404, 404, '接口不存在', null)
}

function lanIPv4() {
  let nets
  try {
    nets = os.networkInterfaces()
  } catch (err) {
    console.error('[net] 读取网卡地址失败:', err.message)
    return []
  }
  const ips = []
  Object.keys(nets).forEach((name) => {
    ;(nets[name] || []).forEach((net) => {
      const family = net.family
      if ((family === 'IPv4' || family === 4) && !net.internal) ips.push(net.address)
    })
  })
  return ips
}

async function main() {
  const instance = await Aedes.createBroker({ maxClientsIdLength: 64 })
  attachBroker(instance)

  const httpServer = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err)
      send(res, 500, 500, err.message || '服务器异常', null)
    })
  })

  const mqttServer = net.createServer(instance.handle)

  await new Promise((resolve) => {
    httpServer.listen(config.httpPort, '0.0.0.0', resolve)
  })
  await new Promise((resolve) => {
    mqttServer.listen(config.mqttPort, '0.0.0.0', resolve)
  })

  const ips = lanIPv4()
  console.log(`[http] http://127.0.0.1:${config.httpPort}`)
  ips.forEach((ip) => console.log(`[http] http://${ip}:${config.httpPort}`))
  console.log('[http] 小程序开发者工具请把 config.js 的 apiBase 设为 http://127.0.0.1:' + config.httpPort)
  console.log('[http] 并勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」')
  console.log(`[mqtt] mqtt://127.0.0.1:${config.mqttPort}`)
  ips.forEach((ip) => console.log(`[mqtt] 固件 MQTT_HOST 填 ${ip}`))
  if (!ips.length) console.log('[mqtt] 没有发现局域网 IPv4，请确认电脑已连上 WiFi')

  if (config.virtualLock) startVirtualLock()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
