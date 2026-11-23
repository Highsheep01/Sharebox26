/**
 * 本地开锁服务配置
 *
 * unlockToken 必须和 firmware/sharebox_lock/sharebox_lock.ino 里的 UNLOCK_TOKEN 一致。
 * 微信「扫普通链接二维码」的校验文件放到 public/，会按网站根路径提供。
 */
module.exports = {
  httpPort: 3000,
  mqttPort: 1883,

  /** 下发给设备的开锁口令，设备核对后才会吸合继电器 */
  unlockToken: 'sharebox-dev-token',

  /**
   * 进程内虚拟锁。为 true 时不需要 ESP32，服务自己订阅开锁指令并上报 opened。
   * 烧录真机后改为 false，否则会和固件抢同一个 MQTT 客户端。
   */
  virtualLock: false,

  boxes: [
    {
      boxCode: 'BOX1001',
      name: '共享盒子 · 电磁锁',
      deviceId: 'dev_1001',
      address: 'ESP32 DevKit V1',
      notice: '开锁后电磁锁会收回约 3 秒，请拉开盒门',
      goods: [],
    },
  ],
}
