import base from "./base.js";

export default class Wallet extends base {
  constructor(e) {
    super(e);
    this.model = "wallet";
  }

  /** 钱包key */
  get walletKey() {
    return `Yz:wallet:${this.userId}`;
  }

  /**
   * 获取余额，如果没有则初始化为10000
   */
  async getBalance() {
    let val = await redis.get(this.walletKey);
    if (val === null) {
      await redis.set(this.walletKey, 10000);
      return 10000;
    }
    val = parseInt(val);
    if (isNaN(val)) val = 0;
    if (val < 0) {
      val = 0;
      await redis.set(this.walletKey, val);
    }
    return val;
  }

  /** 设置余额 */
  async setBalance(amount) {
    amount = Math.max(0, parseInt(amount));
    await redis.set(this.walletKey, amount);
    return amount;
  }

  /** 增加金币 */
  async add(amount) {
    amount = parseInt(amount);
    if (isNaN(amount)) amount = 0;
    const balance = await this.getBalance();
    return this.setBalance(balance + amount);
  }

  /** 扣除金币，余额不足返回false */
  async deduct(amount) {
    amount = parseInt(amount);
    if (isNaN(amount) || amount <= 0) return false;
    let balance = await this.getBalance();
    if (balance < amount) return false;
    await this.setBalance(balance - amount);
    return true;
  }
}