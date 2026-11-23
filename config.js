/**
 * 全局配置
 *
 * useMock = true  时，全部数据走本地模拟（可在开发者工具里完整跑通「扫码 → 选货 → 支付 → 开锁」全流程）
 * useMock = false 时，盒子列表和直接开锁走本机 server/（先在 server 目录执行 npm start）
 *
 * 开发者工具请勾选：详情 → 本地设置 → 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书。
 * 真机预览必须把 apiBase 换成已配置的 HTTPS 合法域名。
 */
module.exports = {
  useMock: false,

  /**
   * 进入盒子页后直接开锁，不走选商品和支付。
   * 关掉后恢复原来的下单结算流程（需要订单接口）。
   */
  directUnlock: true,

  /** 后端服务地址（useMock = false 时生效）。开发者工具用本机地址。 */
  apiBase: 'http://127.0.0.1:3000',

  /** 首页「跳过扫码」进入的虚拟锁，需与 server/config.js 里的 boxCode 一致 */
  virtualBoxCode: 'BOX1001',

  /**
   * true 时锁在小程序内模拟，不请求服务器。
   * 接 ESP32 时保持 false，开锁指令会发给本机 server，再经 MQTT 到开发板。
   */
  localVirtualLock: false,

  /** 网络请求超时（毫秒） */
  timeout: 15000,

  /**
   * 贴在盒子上的「普通链接二维码」链接前缀
   *
   * 需要在微信公众平台：管理后台 → 开发管理 → 开发设置 → 扫普通链接二维码打开小程序
   * 配置一条规则：
   *   二维码规则      https://s.sharebox.com/b/
   *   校验文件        放到 server/public/，本地服务会按网站根路径提供
   *   小程序页面路径  pages/index/index
   *   测试范围 / 发布 按需选择
   *
   * 扫码后微信会把完整链接 URL 编码后放入页面 onLoad 的 options.q，
   * 由 utils/qrcode.js 解析出末尾的盒子编号。
   *
   * 如果改用「小程序码」（wxacode.getUnlimited），则把盒子编号放进 scene，
   * 格式见下方 sceneKey，解析逻辑同样在 utils/qrcode.js 中。
   */
  qrLinkPrefix: 'https://s.sharebox.com/b/',

  /** 小程序码 scene 参数名（scene 总长度不能超过 32 字符） */
  sceneKey: 'bc',

  /** 下发开锁指令后，等待盒子回执的超时时间（毫秒） */
  unlockTimeout: 15000,

  /** 轮询开锁状态的间隔（毫秒） */
  unlockPollInterval: 1000,
}
